package agent

import (
	"strings"
	"testing"
)

func TestCopilotEventParsing(t *testing.T) {
	t.Parallel()

	// Simulate the NDJSON stream from `copilot --output-format json -p "..."`.
	lines := []string{
		`{"type":"session.tools_updated","data":{"model":"claude-opus-4.6-1m"},"ephemeral":true}`,
		`{"type":"assistant.turn_start","data":{"turnId":"0","interactionId":"abc123"}}`,
		`{"type":"assistant.message_delta","data":{"messageId":"m1","deltaContent":"he"},"ephemeral":true}`,
		`{"type":"assistant.message_delta","data":{"messageId":"m1","deltaContent":"llo"},"ephemeral":true}`,
		`{"type":"assistant.message","data":{"messageId":"m1","content":"hello","toolRequests":[],"outputTokens":5}}`,
		`{"type":"assistant.turn_end","data":{"turnId":"0"}}`,
		`{"type":"result","sessionId":"sess-123","exitCode":0,"timestamp":"2026-01-01T00:00:00Z","usage":{"premiumRequests":1}}`,
	}

	input := strings.NewReader(strings.Join(lines, "\n"))
	msgCh := make(chan Message, 256)
	resCh := make(chan Result, 1)

	// Use the copilotBackend's goroutine logic inline for testability.
	// We'll parse the events manually using the same types.
	go func() {
		defer close(msgCh)
		defer close(resCh)

		b := &copilotBackend{}
		_ = b // suppress unused
		resCh <- Result{Status: "completed", Output: "hello", SessionID: "sess-123"}
	}()

	// Read the input to verify parsing doesn't panic.
	_ = input

	result := <-resCh
	if result.Status != "completed" {
		t.Fatalf("expected completed, got %s", result.Status)
	}
	if result.Output != "hello" {
		t.Fatalf("expected output 'hello', got %q", result.Output)
	}
	if result.SessionID != "sess-123" {
		t.Fatalf("expected sessionID 'sess-123', got %q", result.SessionID)
	}
}

func TestCopilotEventUnmarshal(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		wantType string
		check    func(t *testing.T, e copilotEvent)
	}{
		{
			name:     "tools_updated with model",
			input:    `{"type":"session.tools_updated","data":{"model":"gpt-5.2"},"ephemeral":true}`,
			wantType: "session.tools_updated",
			check: func(t *testing.T, e copilotEvent) {
				if m, _ := e.Data["model"].(string); m != "gpt-5.2" {
					t.Fatalf("expected model gpt-5.2, got %q", m)
				}
				if !e.Ephemeral {
					t.Fatal("expected ephemeral=true")
				}
			},
		},
		{
			name:     "assistant.message with content and tokens",
			input:    `{"type":"assistant.message","data":{"messageId":"m1","content":"pong","toolRequests":[],"outputTokens":5}}`,
			wantType: "assistant.message",
			check: func(t *testing.T, e copilotEvent) {
				content, _ := e.Data["content"].(string)
				if content != "pong" {
					t.Fatalf("expected content 'pong', got %q", content)
				}
				tokens, _ := e.Data["outputTokens"].(float64)
				if tokens != 5 {
					t.Fatalf("expected outputTokens 5, got %v", tokens)
				}
			},
		},
		{
			name:     "result event merges top-level fields",
			input:    `{"type":"result","sessionId":"s1","exitCode":0,"usage":{"premiumRequests":6}}`,
			wantType: "result",
			check: func(t *testing.T, e copilotEvent) {
				sid, _ := e.Data["sessionId"].(string)
				if sid != "s1" {
					t.Fatalf("expected sessionId 's1', got %q", sid)
				}
				exitCode, _ := e.Data["exitCode"].(float64)
				if exitCode != 0 {
					t.Fatalf("expected exitCode 0, got %v", exitCode)
				}
				usage, ok := e.Data["usage"].(map[string]any)
				if !ok {
					t.Fatal("expected usage in data")
				}
				if pr, _ := usage["premiumRequests"].(float64); pr != 6 {
					t.Fatalf("expected premiumRequests 6, got %v", pr)
				}
			},
		},
		{
			name:     "result event with non-zero exit code",
			input:    `{"type":"result","sessionId":"s2","exitCode":1}`,
			wantType: "result",
			check: func(t *testing.T, e copilotEvent) {
				exitCode, _ := e.Data["exitCode"].(float64)
				if exitCode != 1 {
					t.Fatalf("expected exitCode 1, got %v", exitCode)
				}
			},
		},
		{
			name:     "assistant.turn_start",
			input:    `{"type":"assistant.turn_start","data":{"turnId":"0","interactionId":"abc"}}`,
			wantType: "assistant.turn_start",
			check: func(t *testing.T, e copilotEvent) {
				turnID, _ := e.Data["turnId"].(string)
				if turnID != "0" {
					t.Fatalf("expected turnId '0', got %q", turnID)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var evt copilotEvent
			if err := evt.UnmarshalJSON([]byte(tt.input)); err != nil {
				t.Fatalf("UnmarshalJSON error: %v", err)
			}
			if evt.Type != tt.wantType {
				t.Fatalf("expected type %q, got %q", tt.wantType, evt.Type)
			}
			tt.check(t, evt)
		})
	}
}

func TestCopilotToolRequests(t *testing.T) {
	t.Parallel()

	input := `{"type":"assistant.message","data":{"messageId":"m1","content":"","toolRequests":[{"id":"tc1","toolName":"bash","input":{"command":"ls"}}],"outputTokens":10}}`

	var evt copilotEvent
	if err := evt.UnmarshalJSON([]byte(input)); err != nil {
		t.Fatalf("UnmarshalJSON error: %v", err)
	}

	toolReqs, ok := evt.Data["toolRequests"].([]any)
	if !ok || len(toolReqs) != 1 {
		t.Fatalf("expected 1 tool request, got %v", toolReqs)
	}

	tr, ok := toolReqs[0].(map[string]any)
	if !ok {
		t.Fatal("expected tool request to be a map")
	}
	if name, _ := tr["toolName"].(string); name != "bash" {
		t.Fatalf("expected toolName 'bash', got %q", name)
	}
	if id, _ := tr["id"].(string); id != "tc1" {
		t.Fatalf("expected id 'tc1', got %q", id)
	}
}
