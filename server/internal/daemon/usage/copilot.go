package usage

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// scanCopilot reads Copilot CLI session event logs from ~/.copilot/session-state/*/events.jsonl
// and extracts token usage from "assistant.message" lines that contain outputTokens.
func (s *Scanner) scanCopilot() []Record {
	root := copilotSessionRoot()
	if root == "" {
		return nil
	}

	files, err := filepath.Glob(filepath.Join(root, "*", "events.jsonl"))
	if err != nil {
		s.logger.Debug("copilot glob error", "root", root, "error", err)
		return nil
	}

	seen := make(map[string]bool)
	var allRecords []Record
	for _, f := range files {
		records := s.parseCopilotFile(f, seen)
		allRecords = append(allRecords, records...)
	}

	return mergeRecords(allRecords)
}

func copilotSessionRoot() string {
	// Check COPILOT_CONFIG_DIR env var
	if configDir := os.Getenv("COPILOT_CONFIG_DIR"); configDir != "" {
		dir := filepath.Join(configDir, "session-state")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	dir := filepath.Join(home, ".copilot", "session-state")
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		return dir
	}
	return ""
}

// copilotLine represents the subset of a Copilot JSONL event we care about.
type copilotLine struct {
	Type      string         `json:"type"`
	Timestamp string         `json:"timestamp"`
	ID        string         `json:"id"`
	Data      map[string]any `json:"data"`
}

func (s *Scanner) parseCopilotFile(path string, seen map[string]bool) []Record {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var records []Record
	var lastModel string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()

		// Fast pre-filter
		if !bytesContains(line, `"outputTokens"`) {
			// Track model from session.tools_updated
			if bytesContains(line, `"session.tools_updated"`) {
				var entry copilotLine
				if json.Unmarshal(line, &entry) == nil && entry.Data != nil {
					if m, ok := entry.Data["model"].(string); ok && m != "" {
						lastModel = m
					}
				}
			}
			continue
		}

		var entry copilotLine
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		if entry.Type != "assistant.message" || entry.Data == nil {
			continue
		}

		outputTokens, _ := entry.Data["outputTokens"].(float64)
		inputTokens, _ := entry.Data["inputTokens"].(float64)
		if outputTokens == 0 && inputTokens == 0 {
			continue
		}

		// Dedup by event ID
		if entry.ID != "" {
			if seen[entry.ID] {
				continue
			}
			seen[entry.ID] = true
		}

		ts, err := time.Parse(time.RFC3339Nano, entry.Timestamp)
		if err != nil {
			ts, err = time.Parse(time.RFC3339, entry.Timestamp)
			if err != nil {
				continue
			}
		}

		model := lastModel
		if model == "" {
			model = "unknown"
		}

		records = append(records, Record{
			Date:         ts.Local().Format("2006-01-02"),
			Provider:     "copilot",
			Model:        model,
			InputTokens:  int64(inputTokens),
			OutputTokens: int64(outputTokens),
		})
	}

	return records
}
