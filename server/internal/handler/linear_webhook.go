package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// LinearWebhook handles incoming Linear webhook events for a workspace.
// It verifies the signature, parses the event, and creates mirror issues
// in Multica for issues that match the configured active states.
func (h *Handler) LinearWebhook(w http.ResponseWriter, r *http.Request) {
	wsSlug := chi.URLParam(r, "workspaceSlug")

	body, err := io.ReadAll(io.LimitReader(r.Body, 5*1024*1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	ws, err := h.Queries.GetWorkspaceBySlug(r.Context(), wsSlug)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	// Verify Linear webhook signature if configured.
	integration, err := h.Queries.GetWorkspaceIntegrationByProvider(r.Context(), db.GetWorkspaceIntegrationByProviderParams{
		WorkspaceID: ws.ID,
		Provider:    "linear",
	})
	if err != nil {
		slog.Warn("linear webhook: no integration configured", "workspace", wsSlug)
		writeError(w, http.StatusNotFound, "integration not configured")
		return
	}

	if !integration.Enabled {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
		return
	}

	if integration.WebhookSecret.Valid && integration.WebhookSecret.String != "" {
		sig := r.Header.Get("Linear-Signature")
		if !verifyLinearSignature(body, sig, integration.WebhookSecret.String) {
			writeError(w, http.StatusUnauthorized, "invalid signature")
			return
		}
	}

	// Parse the Linear webhook payload.
	var payload linearWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		slog.Warn("linear webhook: invalid payload", "error", err, "workspace", wsSlug)
		writeError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	slog.Info("linear webhook received",
		append(logger.RequestAttrs(r), "action", payload.Action, "type", payload.Type, "workspace", wsSlug)...)

	switch {
	case payload.Type == "Issue" && (payload.Action == "create" || payload.Action == "update"):
		h.handleLinearIssueEvent(r, ws, integration, payload)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}

// linearWebhookPayload represents the top-level Linear webhook event.
type linearWebhookPayload struct {
	Action string          `json:"action"` // "create", "update", "remove"
	Type   string          `json:"type"`   // "Issue", "Comment", etc.
	Data   json.RawMessage `json:"data"`
}

type linearIssueData struct {
	ID          string  `json:"id"`
	Identifier  string  `json:"identifier"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	URL         string  `json:"url"`
	Priority    float64 `json:"priority"`
	State       struct {
		Name string `json:"name"`
	} `json:"state"`
	Assignee *struct {
		ID string `json:"id"`
	} `json:"assignee"`
	Labels []struct {
		Name string `json:"name"`
	} `json:"labels"`
}

func (h *Handler) handleLinearIssueEvent(r *http.Request, ws db.Workspace, integration db.WorkspaceIntegration, payload linearWebhookPayload) {
	var issueData linearIssueData
	if err := json.Unmarshal(payload.Data, &issueData); err != nil {
		slog.Warn("linear webhook: failed to parse issue data", "error", err)
		return
	}

	// Determine active states from config.
	var config service.LinearIntegrationConfig
	if err := json.Unmarshal(integration.Config, &config); err != nil {
		slog.Warn("linear webhook: failed to parse integration config", "error", err)
	}

	activeStates := config.ActiveStates
	if len(activeStates) == 0 {
		activeStates = []string{"Todo"} // Default: only pick up "Todo" items.
	}

	stateName := issueData.State.Name
	isActive := false
	for _, s := range activeStates {
		if strings.EqualFold(s, stateName) {
			isActive = true
			break
		}
	}

	if !isActive {
		slog.Debug("linear webhook: issue not in active state", "state", stateName, "identifier", issueData.Identifier)
		return
	}

	if h.IntegrationService == nil {
		slog.Error("linear webhook: IntegrationService not initialized")
		return
	}

	ext := service.ExternalIssue{
		Provider:    "linear",
		ExternalID:  issueData.ID,
		Identifier:  issueData.Identifier,
		Title:       issueData.Title,
		Description: issueData.Description,
		URL:         issueData.URL,
		Priority:    strconv.Itoa(int(issueData.Priority)),
		Status:      stateName,
	}

	issue, created, err := h.IntegrationService.ImportExternalIssue(r.Context(), ws.ID, integration, ext)
	if err != nil {
		slog.Warn("linear webhook: import failed", "error", err, "identifier", issueData.Identifier)
		return
	}

	if created {
		prefix := h.getIssuePrefix(r.Context(), issue.WorkspaceID)
		resp := issueToResponse(issue, prefix)
		wsID := util.UUIDToString(ws.ID)
		h.publish(protocol.EventIssueCreated, wsID, "system", "", map[string]any{"issue": resp})

		// Enqueue task for the assigned agent.
		if issue.AssigneeType.Valid && issue.AssigneeID.Valid {
			if _, err := h.TaskService.EnqueueTaskForIssue(r.Context(), issue); err != nil {
				slog.Warn("linear webhook: task enqueue failed", "error", err, "issue_id", util.UUIDToString(issue.ID))
			}
		}

		slog.Info("linear webhook: created mirror issue",
			"identifier", issueData.Identifier,
			"issue_id", util.UUIDToString(issue.ID),
			"workspace", util.UUIDToString(ws.ID),
		)
	} else {
		slog.Debug("linear webhook: issue already imported", "identifier", issueData.Identifier)
	}
}

func verifyLinearSignature(body []byte, signature, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}
