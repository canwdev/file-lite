package routes

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
	"file-lite-go/tasks"
)

// 任务的 REST 命令面（docs/design/api.md §7）。
//
// 命令走 HTTP，进度 / 冲突 / 结束仍然通过 WebSocket 推送：任务管理器是同一个，
// 两种传输只是它的两个出口。

// findTaskSnapshot 按 id 找快照。任务列表很短，线性查找足够，也避免给管理器加接口。
func findTaskSnapshot(m *tasks.Manager, id string) (tasks.Snapshot, bool) {
	for _, snap := range m.List() {
		if snap.ID == id {
			return snap, true
		}
	}
	return tasks.Snapshot{}, false
}

// createTaskAPI 实现 POST /api/tasks。
func createTaskAPI(c echo.Context) error {
	m := currentTaskManager()
	if m == nil {
		return apierr.ServiceUnavailable(apierr.CodeServerBusy, "Task service unavailable")
	}

	var body struct {
		Kind       string   `json:"kind"`
		FromPaths  []string `json:"fromPaths"`
		ToPath     string   `json:"toPath"`
		OnConflict string   `json:"onConflict"`
		Format     string   `json:"format"`
		Password   string   `json:"password"`
		IntoFolder bool     `json:"intoFolder"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}
	if body.Kind == "" || len(body.FromPaths) == 0 {
		return apierr.BadRequest(apierr.CodeBadRequest, "kind and fromPaths are required")
	}
	if !tasks.IsValidKind(tasks.Kind(body.Kind)) {
		return apierr.BadRequest(apierr.CodeUnsupportedTaskKind, "Unsupported task kind")
	}

	snap, err := m.Create(tasks.CreateParams{
		Kind:       tasks.Kind(body.Kind),
		FromPaths:  body.FromPaths,
		ToPath:     body.ToPath,
		OnConflict: fileops.NormalizePolicy(body.OnConflict),
		Format:     body.Format,
		Password:   body.Password,
		IntoFolder: body.IntoFolder,
	})
	if err != nil {
		if errors.Is(err, fileops.ErrPathOutsideRoots) {
			return apierr.Forbidden(apierr.CodeOutsideAllowedRoots, "Path is outside the configured allowed roots")
		}
		// 其余失败都是请求本身的问题（缺目标、源不存在、目标在源子树里…），
		// 消息已经是给用户看的一句话。
		return apierr.BadRequest(apierr.CodeOutOfScope, err.Error())
	}

	c.Response().Header().Set(echo.HeaderLocation, "/api/tasks/"+snap.ID)
	return c.JSON(http.StatusCreated, snap)
}

// listTasksAPI 实现 GET /api/tasks。
func listTasksAPI(c echo.Context) error {
	m := currentTaskManager()
	if m == nil {
		return c.JSON(http.StatusOK, []tasks.Snapshot{})
	}
	return c.JSON(http.StatusOK, m.List())
}

// getTaskAPI 实现 GET /api/tasks/{id}。
func getTaskAPI(c echo.Context) error {
	m := currentTaskManager()
	if m == nil {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}
	snap, ok := findTaskSnapshot(m, c.Param("id"))
	if !ok {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}
	return c.JSON(http.StatusOK, snap)
}

// deleteTaskAPI 实现 DELETE /api/tasks/{id}：还在跑就取消，已经结束就从列表里移除。
func deleteTaskAPI(c echo.Context) error {
	m := currentTaskManager()
	if m == nil {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}
	id := c.Param("id")
	snap, ok := findTaskSnapshot(m, id)
	if !ok {
		// Already dismissed, or cleared twice. Deleting a missing task is not an
		// error: the row is gone, which is what Clear finished asked for.
		return c.NoContent(http.StatusNoContent)
	}

	if snap.State.IsTerminal() {
		if err := m.Dismiss(id); err != nil {
			return apierr.Conflict(apierr.CodeConflict, err.Error())
		}
		return c.NoContent(http.StatusNoContent)
	}
	if err := m.Cancel(id); err != nil {
		return apierr.Conflict(apierr.CodeConflict, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

// retryTaskAPI 实现 POST /api/tasks/{id}/retries：用失败 / 冲突的条目重开一个任务。
func retryTaskAPI(c echo.Context) error {
	m := currentTaskManager()
	if m == nil {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}
	id := c.Param("id")
	if _, ok := findTaskSnapshot(m, id); !ok {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}

	snap, err := m.Retry(id)
	if err != nil {
		return apierr.Conflict(apierr.CodeConflict, err.Error())
	}
	c.Response().Header().Set(echo.HeaderLocation, "/api/tasks/"+snap.ID)
	return c.JSON(http.StatusCreated, snap)
}

// resolveTaskAPI 实现 POST /api/tasks/{id}/resolutions：回答一次冲突。
func resolveTaskAPI(c echo.Context) error {
	m := currentTaskManager()
	if m == nil {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}
	id := c.Param("id")
	if _, ok := findTaskSnapshot(m, id); !ok {
		return apierr.NotFound(apierr.CodeTaskNotFound, "Task not found")
	}

	var body struct {
		Policy     string `json:"policy"`
		ApplyToAll bool   `json:"applyToAll"`
		Items      []struct {
			RelativePath string `json:"relativePath"`
			Policy       string `json:"policy"`
		} `json:"items"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}

	items := make(map[string]fileops.Policy, len(body.Items))
	for _, item := range body.Items {
		if item.RelativePath == "" {
			continue
		}
		items[item.RelativePath] = fileops.NormalizePolicy(item.Policy)
	}

	if err := m.Resolve(id, tasks.ResolveRequest{
		Policy:     fileops.NormalizePolicy(body.Policy),
		ApplyToAll: body.ApplyToAll,
		Items:      items,
	}); err != nil {
		return apierr.Conflict(apierr.CodeConflict, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}
