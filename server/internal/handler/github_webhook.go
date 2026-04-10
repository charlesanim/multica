package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// GitHubWebhook handles incoming GitHub webhook events for a workspace.
// It verifies the HMAC signature, parses the event, and triggers agent
// tasks for relevant PR events (review comments, reviews, PR status changes).
func (h *Handler) GitHubWebhook(w http.ResponseWriter, r *http.Request) {
	wsSlug := chi.URLParam(r, "workspaceSlug")

	body, err := io.ReadAll(io.LimitReader(r.Body, 5*1024*1024)) // 5MB max
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	// Look up workspace by slug.
	ws, err := h.Queries.GetWorkspaceBySlug(r.Context(), wsSlug)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	// Verify HMAC signature if webhook secret is configured.
	if ws.WebhookSecret.Valid && ws.WebhookSecret.String != "" {
		sig := r.Header.Get("X-Hub-Signature-256")
		if !verifyGitHubSignature(body, sig, ws.WebhookSecret.String) {
			writeError(w, http.StatusUnauthorized, "invalid signature")
			return
		}
	}

	event := r.Header.Get("X-GitHub-Event")
	slog.Info("github webhook received", append(logger.RequestAttrs(r), "event", event, "workspace", wsSlug)...)

	switch event {
	case "pull_request_review_comment":
		h.handlePRReviewComment(r, ws, body)
	case "pull_request_review":
		h.handlePRReview(r, ws, body)
	case "issue_comment":
		// PR comments come as issue_comment events when posted on the PR conversation
		h.handleIssueComment(r, ws, body)
	}

	// Always return 200 to acknowledge receipt.
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}

// handlePRReviewComment processes inline review comments on PR diffs.
// It finds the Multica issue linked to the PR and @mentions the assigned agent.
func (h *Handler) handlePRReviewComment(r *http.Request, ws db.Workspace, body []byte) {
	var payload struct {
		Action      string `json:"action"`
		PullRequest struct {
			Number int    `json:"number"`
			HTMLURL string `json:"html_url"`
			Head   struct {
				Ref string `json:"ref"` // branch name
			} `json:"head"`
		} `json:"pull_request"`
		Comment struct {
			Body    string `json:"body"`
			User    struct{ Login string } `json:"user"`
			HTMLURL string `json:"html_url"`
			Path    string `json:"path"`
			Line    *int   `json:"line"`
		} `json:"comment"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Action != "created" {
		return
	}

	// Skip comments from bots/agents to avoid loops.
	login := payload.Comment.User.Login
	if strings.HasSuffix(login, "[bot]") || login == "github-actions" {
		return
	}

	prNumber := payload.PullRequest.Number
	branchName := payload.PullRequest.Head.Ref
	commentBody := payload.Comment.Body
	commentURL := payload.Comment.HTMLURL
	filePath := payload.Comment.Path

	h.notifyAgentAboutPR(r, ws, prNumber, branchName,
		fmt.Sprintf("New PR review comment from @%s on `%s`:\n> %s\n\n[View on GitHub](%s)",
			login, filePath, truncate(commentBody, 300), commentURL))
}

// handlePRReview processes PR review submissions (approve, request changes, comment).
func (h *Handler) handlePRReview(r *http.Request, ws db.Workspace, body []byte) {
	var payload struct {
		Action string `json:"action"`
		Review struct {
			State string `json:"state"` // "approved", "changes_requested", "commented"
			Body  string `json:"body"`
			User  struct{ Login string } `json:"user"`
			HTMLURL string `json:"html_url"`
		} `json:"review"`
		PullRequest struct {
			Number int    `json:"number"`
			Head   struct{ Ref string } `json:"head"`
		} `json:"pull_request"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Action != "submitted" {
		return
	}

	login := payload.Review.User.Login
	if strings.HasSuffix(login, "[bot]") || login == "github-actions" {
		return
	}

	// Only notify on reviews with substance.
	state := payload.Review.State
	if state != "changes_requested" && state != "commented" {
		return
	}

	h.notifyAgentAboutPR(r, ws, payload.PullRequest.Number, payload.PullRequest.Head.Ref,
		fmt.Sprintf("PR review from @%s (%s):\n> %s\n\n[View on GitHub](%s)",
			login, state, truncate(payload.Review.Body, 300), payload.Review.HTMLURL))
}

// handleIssueComment processes comments on PRs (posted via the conversation tab).
func (h *Handler) handleIssueComment(r *http.Request, ws db.Workspace, body []byte) {
	var payload struct {
		Action string `json:"action"`
		Issue  struct {
			Number      int `json:"number"`
			PullRequest *struct {
				URL string `json:"url"`
			} `json:"pull_request"`
		} `json:"issue"`
		Comment struct {
			Body    string `json:"body"`
			User    struct{ Login string } `json:"user"`
			HTMLURL string `json:"html_url"`
		} `json:"comment"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Action != "created" {
		return
	}

	// Only PR comments (issue_comment events that have pull_request set).
	if payload.Issue.PullRequest == nil {
		return
	}

	login := payload.Comment.User.Login
	if strings.HasSuffix(login, "[bot]") || login == "github-actions" {
		return
	}

	h.notifyAgentAboutPR(r, ws, payload.Issue.Number, "",
		fmt.Sprintf("New comment on PR from @%s:\n> %s\n\n[View on GitHub](%s)",
			login, truncate(payload.Comment.Body, 300), payload.Comment.HTMLURL))
}

// notifyAgentAboutPR finds the Multica issue linked to a PR (by branch name or PR URL
// in comments) and posts a notification comment tagging the assigned agent.
func (h *Handler) notifyAgentAboutPR(r *http.Request, ws db.Workspace, prNumber int, branchName, message string) {
	wsID := uuidToString(ws.ID)

	// Strategy 1: Search issues for a comment containing the PR URL.
	prURL := fmt.Sprintf("/pull/%d", prNumber)
	issues, err := h.Queries.SearchIssuesByCommentContent(r.Context(), ws.ID, "%"+prURL+"%")
	if err != nil || len(issues) == 0 {
		// Strategy 2: Search by branch name pattern (agent/<name>/<task-id>).
		if branchName != "" {
			issues, err = h.Queries.SearchIssuesByCommentContent(r.Context(), ws.ID, "%"+branchName+"%")
		}
	}
	if err != nil || len(issues) == 0 {
		slog.Debug("github webhook: no linked issue found", "pr", prNumber, "branch", branchName, "workspace", wsID)
		return
	}

	issue := issues[0]

	// Find the assigned agent.
	if !issue.AssigneeID.Valid || issue.AssigneeType.String != "agent" {
		slog.Debug("github webhook: issue not assigned to agent", "issue", uuidToString(issue.ID), "pr", prNumber)
		return
	}

	agent, err := h.Queries.GetAgent(r.Context(), issue.AssigneeID)
	if err != nil {
		return
	}

	// Post a comment on the Multica issue mentioning the assigned agent.
	content := fmt.Sprintf("GitHub PR #%d feedback:\n\n%s\n\n[@%s](mention://agent/%s) please address this feedback.",
		prNumber, message, agent.Name, uuidToString(agent.ID))

	h.Queries.CreateComment(r.Context(), db.CreateCommentParams{
		IssueID:     issue.ID,
		WorkspaceID: ws.ID,
		AuthorType:  "system",
		Content:     content,
		Type:        "comment",
	})
	slog.Info("github webhook: notified agent", "agent", agent.Name, "issue", uuidToString(issue.ID), "pr", prNumber)
}

func verifyGitHubSignature(body []byte, signature, secret string) bool {
	if !strings.HasPrefix(signature, "sha256=") {
		return false
	}
	sig, err := hex.DecodeString(strings.TrimPrefix(signature, "sha256="))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), sig)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
