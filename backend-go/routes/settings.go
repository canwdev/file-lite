package routes

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/utils"
)

// 设置资源的 REST 命令面（docs/design/api.md §8）。
//
// 键是前端自己起的字符串（可能带点，例如 `filemanager.views`），所以路径用通配段，
// 不做成 `:key`。写入与删除都会广播 settings.sync，多窗口因此仍然实时一致。

func getSettings(c echo.Context) error {
	store, err := utils.GetAllSettingsValues()
	if err != nil {
		return apierr.Internal(apierr.CodeSettingsFailed, "Settings request failed")
	}
	if store == nil {
		store = map[string]any{}
	}
	return c.JSON(http.StatusOK, store)
}

func getSetting(c echo.Context) error {
	key, apiErr := settingsKey(c)
	if apiErr != nil {
		return apiErr
	}
	value, err := utils.GetSettingsValue(key)
	if err != nil {
		return apierr.Internal(apierr.CodeSettingsFailed, "Settings request failed")
	}
	return c.JSON(http.StatusOK, map[string]any{"key": key, "value": value})
}

func putSetting(c echo.Context) error {
	key, apiErr := settingsKey(c)
	if apiErr != nil {
		return apiErr
	}
	var body struct {
		Value any `json:"value"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}

	value, err := utils.SetSettingsValue(key, body.Value)
	if err != nil {
		return apierr.Internal(apierr.CodeSettingsFailed, "Settings request failed")
	}
	broadcastSharedWSSettings(key, value)
	return c.JSON(http.StatusOK, map[string]any{"key": key, "value": value})
}

func deleteSetting(c echo.Context) error {
	key, apiErr := settingsKey(c)
	if apiErr != nil {
		return apiErr
	}
	if _, err := utils.DeleteSettingsValue(key); err != nil {
		return apierr.Internal(apierr.CodeSettingsFailed, "Settings request failed")
	}
	broadcastSharedWSSettings(key, nil)
	return c.NoContent(http.StatusNoContent)
}

// settingsKey 取出通配段里的键并解码一次。
func settingsKey(c echo.Context) (string, *apierr.Error) {
	raw := c.Param("*")
	key, err := url.PathUnescape(raw)
	if err != nil {
		return "", apierr.BadRequest(apierr.CodeBadRequest, "Invalid settings key")
	}
	key = strings.TrimPrefix(key, "/")
	if key == "" {
		return "", apierr.BadRequest(apierr.CodeBadRequest, "key is required")
	}
	return key, nil
}
