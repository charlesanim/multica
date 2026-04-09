package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// copilotBackend implements Backend by spawning the GitHub Copilot CLI
// with --output-format json and --yolo for autonomous execution.
type copilotBackend struct {
	cfg Config
}

func (b *copilotBackend) Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error) {
	execPath := b.cfg.ExecutablePath
	if execPath == "" {
		execPath = "copilot"
	}
	if _, err := exec.LookPath(execPath); err != nil {
		return nil, fmt.Errorf("copilot executable not found at %q: %w", execPath, err)
	}

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 20 * time.Minute
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)

	args := []string{
		"--output-format", "json",
		"--yolo",
	}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	if opts.SystemPrompt != "" {
		args = append(args, "--append-system-prompt", opts.SystemPrompt)
	}
	if opts.ResumeSessionID != "" {
		args = append(args, "--resume", opts.ResumeSessionID)
	}
	args = append(args, "-p", prompt)

	cmd := exec.CommandContext(runCtx, execPath, args...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = buildEnv(b.cfg.Env)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("copilot stdout pipe: %w", err)
	}
	cmd.Stderr = newLogWriter(b.cfg.Logger, "[copilot:stderr] ")

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start copilot: %w", err)
	}

	b.cfg.Logger.Info("copilot started", "pid", cmd.Process.Pid, "cwd", opts.Cwd, "model", opts.Model)

	msgCh := make(chan Message, 256)
	resCh := make(chan Result, 1)

	go func() {
		defer cancel()
		defer close(msgCh)
		defer close(resCh)

		startTime := time.Now()
		var output strings.Builder
		var sessionID string
		var model string
		finalStatus := "completed"
		var finalError string
		var totalOutputTokens int64

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}

			var evt copilotEvent
			if err := json.Unmarshal([]byte(line), &evt); err != nil {
				continue
			}

			switch evt.Type {
			case "session.tools_updated":
				if m, _ := evt.Data["model"].(string); m != "" {
					model = m
				}

			case "assistant.turn_start":
				trySend(msgCh, Message{Type: MessageStatus, Status: "running"})

			case "assistant.message":
				content, _ := evt.Data["content"].(string)
				if content != "" {
					output.WriteString(content)
					trySend(msgCh, Message{Type: MessageText, Content: content})
				}
				if tokens, ok := evt.Data["outputTokens"].(float64); ok {
					totalOutputTokens += int64(tokens)
				}
				// Handle tool requests within the message
				if toolReqs, ok := evt.Data["toolRequests"].([]any); ok {
					for _, tr := range toolReqs {
						if trMap, ok := tr.(map[string]any); ok {
							toolName, _ := trMap["toolName"].(string)
							callID, _ := trMap["id"].(string)
							var input map[string]any
							if inp, ok := trMap["input"].(map[string]any); ok {
								input = inp
							}
							trySend(msgCh, Message{
								Type:   MessageToolUse,
								Tool:   toolName,
								CallID: callID,
								Input:  input,
							})
						}
					}
				}

			case "assistant.tool_result":
				callID, _ := evt.Data["toolCallId"].(string)
				toolOutput, _ := evt.Data["content"].(string)
				if toolOutput == "" {
					if raw, ok := evt.Data["content"]; ok {
						data, _ := json.Marshal(raw)
						toolOutput = string(data)
					}
				}
				trySend(msgCh, Message{
					Type:   MessageToolResult,
					CallID: callID,
					Output: toolOutput,
				})

			case "result":
				if sid, ok := evt.Data["sessionId"].(string); ok {
					sessionID = sid
				}
				// Non-zero exit code means failure unless we already know the status.
				if exitCode, ok := evt.Data["exitCode"].(float64); ok && exitCode != 0 && finalStatus == "completed" {
					finalStatus = "failed"
					finalError = fmt.Sprintf("copilot exited with code %d", int(exitCode))
				}
			}
		}

		exitErr := cmd.Wait()
		duration := time.Since(startTime)

		if runCtx.Err() == context.DeadlineExceeded {
			finalStatus = "timeout"
			finalError = fmt.Sprintf("copilot timed out after %s", timeout)
		} else if runCtx.Err() == context.Canceled {
			finalStatus = "aborted"
			finalError = "execution cancelled"
		} else if exitErr != nil && finalStatus == "completed" {
			finalStatus = "failed"
			finalError = fmt.Sprintf("copilot exited with error: %v", exitErr)
		}

		b.cfg.Logger.Info("copilot finished", "pid", cmd.Process.Pid, "status", finalStatus, "duration", duration.Round(time.Millisecond).String())

		var usage map[string]TokenUsage
		if totalOutputTokens > 0 {
			m := model
			if m == "" {
				m = opts.Model
			}
			if m == "" {
				m = "unknown"
			}
			usage = map[string]TokenUsage{m: {OutputTokens: totalOutputTokens}}
		}

		resCh <- Result{
			Status:     finalStatus,
			Output:     output.String(),
			Error:      finalError,
			DurationMs: duration.Milliseconds(),
			SessionID:  sessionID,
			Usage:      usage,
		}
	}()

	return &Session{Messages: msgCh, Result: resCh}, nil
}

// copilotEvent represents a single NDJSON line from `copilot --output-format json`.
type copilotEvent struct {
	Type      string         `json:"type"`
	Data      map[string]any `json:"data,omitempty"`
	ID        string         `json:"id,omitempty"`
	Timestamp string         `json:"timestamp,omitempty"`
	ParentID  string         `json:"parentId,omitempty"`
	Ephemeral bool           `json:"ephemeral,omitempty"`
	// Top-level fields on "result" events
	SessionID string  `json:"sessionId,omitempty"`
	ExitCode  float64 `json:"exitCode,omitempty"`
}

// UnmarshalJSON implements custom unmarshalling to handle the "result" event
// which puts sessionId/exitCode at the top level instead of inside data.
func (e *copilotEvent) UnmarshalJSON(b []byte) error {
	type plain copilotEvent
	if err := json.Unmarshal(b, (*plain)(e)); err != nil {
		return err
	}
	// For "result" events, merge top-level fields into data for uniform access.
	if e.Type == "result" {
		if e.Data == nil {
			e.Data = make(map[string]any)
		}
		if e.SessionID != "" {
			e.Data["sessionId"] = e.SessionID
		}
		e.Data["exitCode"] = e.ExitCode
		// Also parse usage from the top-level if present in the raw JSON.
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(b, &raw); err == nil {
			if u, ok := raw["usage"]; ok {
				var usage map[string]any
				if json.Unmarshal(u, &usage) == nil {
					e.Data["usage"] = usage
				}
			}
		}
	}
	return nil
}
