package daemon

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// syncLocalSkills scans ~/.agents/skills/ for SKILL.md files and creates
// any skills that don't already exist in the workspace.
func (d *Daemon) syncLocalSkills(ctx context.Context, workspaceID string) {
	roots := localSkillRoots()
	if len(roots) == 0 {
		return
	}

	// Load existing workspace skills for dedup.
	existing, err := d.client.ListSkills(ctx, workspaceID)
	if err != nil {
		d.logger.Warn("skill sync: failed to list workspace skills", "error", err)
		return
	}
	existingNames := make(map[string]bool, len(existing))
	for _, s := range existing {
		existingNames[strings.ToLower(s.Name)] = true
	}

	var created, skipped int
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			d.logger.Debug("skill sync: cannot read directory", "path", root, "error", err)
			continue
		}

		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}

			skillDir := filepath.Join(root, entry.Name())
			skillMD := filepath.Join(skillDir, "SKILL.md")
			content, err := os.ReadFile(skillMD)
			if err != nil {
				continue // No SKILL.md, skip
			}

			name, description, body := parseSkillMD(string(content), entry.Name())

			if existingNames[strings.ToLower(name)] {
				skipped++
				continue
			}

			// Collect additional files in the skill directory.
			var files []map[string]string
			filepath.WalkDir(skillDir, func(path string, d os.DirEntry, err error) error {
				if err != nil || d.IsDir() || filepath.Base(path) == "SKILL.md" {
					return nil
				}
				relPath, _ := filepath.Rel(skillDir, path)
				data, err := os.ReadFile(path)
				if err != nil {
					return nil
				}
				files = append(files, map[string]string{
					"path":    relPath,
					"content": string(data),
				})
				return nil
			})

			payload := map[string]any{
				"name":        name,
				"description": description,
				"content":     body,
			}
			if len(files) > 0 {
				payload["files"] = files
			}

			if err := d.client.CreateSkill(ctx, workspaceID, payload); err != nil {
				d.logger.Warn("skill sync: failed to create skill", "name", name, "error", err)
				continue
			}
			existingNames[strings.ToLower(name)] = true
			created++
		}
	}

	if created > 0 || skipped > 0 {
		d.logger.Info("skill sync: completed", "created", created, "skipped_existing", skipped)
	}
}

// localSkillRoots returns directories to scan for local skills.
func localSkillRoots() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var roots []string
	candidates := []string{
		filepath.Join(home, ".agents", "skills"),
	}
	for _, dir := range candidates {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			roots = append(roots, dir)
		}
	}
	return roots
}

// parseSkillMD extracts name, description, and body from a SKILL.md file.
// It parses optional YAML frontmatter delimited by --- lines.
func parseSkillMD(raw string, dirName string) (name, description, body string) {
	name = dirName
	body = raw

	// Parse YAML frontmatter if present.
	if strings.HasPrefix(raw, "---\n") || strings.HasPrefix(raw, "---\r\n") {
		end := strings.Index(raw[3:], "\n---")
		if end >= 0 {
			frontmatter := raw[4 : 3+end]
			body = strings.TrimSpace(raw[3+end+4:])

			var meta struct {
				Name        string `yaml:"name"`
				Description string `yaml:"description"`
			}
			if err := yaml.Unmarshal([]byte(frontmatter), &meta); err == nil {
				if meta.Name != "" {
					name = meta.Name
				}
				if meta.Description != "" {
					description = meta.Description
				}
			}
		}
	}

	// Truncate description if too long.
	if len(description) > 500 {
		description = description[:500]
	}

	// Use first heading as name if frontmatter didn't provide one.
	if name == dirName && strings.HasPrefix(body, "# ") {
		if nl := strings.Index(body, "\n"); nl > 0 {
			name = strings.TrimSpace(body[2:nl])
		}
	}

	_ = name // satisfy import
	return name, description, body
}
