package routes

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"file-lite-go/config"
	"file-lite-go/utils"
)

const sharedWSFrontendStorageWatchDebounce = 200 * time.Millisecond

var sharedWSSettingsWatcher = struct {
	sync.Mutex
	watcher *fsnotify.Watcher
}{}

func StartSharedWSServices() {
	startSharedWSFrontendStorageWatcher()
}

func StopSharedWSServices() {
	stopSharedWSFrontendStorageWatcher()
	clearSharedWSTextSyncState()
}

func handleSharedWSSettingsMessage(client *sharedWSClient, msg sharedWSSettingsClientMessage) {
	var (
		value any
		err   error
	)

	switch msg.Type {
	case "get":
		value, err = utils.GetSettingsValue(msg.Key)
	case "set":
		value, err = utils.SetSettingsValue(msg.Key, msg.Value)
	case "delete":
		value, err = utils.DeleteSettingsValue(msg.Key)
	default:
		sendSharedWSError(client, "settings", msg.RequestID, "Invalid payload")
		return
	}

	if err != nil {
		sendSharedWSError(client, "settings", msg.RequestID, "Settings request failed")
		return
	}

	sendSharedWSJSON(client, map[string]any{
		"scope":     "settings",
		"type":      "response",
		"requestId": msg.RequestID,
		"action":    msg.Type,
		"key":       msg.Key,
		"value":     value,
	})

	if msg.Type == "set" || msg.Type == "delete" {
		broadcastSharedWSSettings(msg.Key, value)
	}
}

func broadcastSharedWSSettings(key string, value any) {
	clients := snapshotSharedWSClients()
	message := map[string]any{
		"scope": "settings",
		"type":  "sync",
		"key":   key,
		"value": value,
	}
	for _, client := range clients {
		sendSharedWSJSON(client, message)
	}
}

func broadcastSharedWSSettingsSnapshot(previous map[string]any, current map[string]any) {
	keys := map[string]struct{}{}
	for key := range previous {
		keys[key] = struct{}{}
	}
	for key := range current {
		keys[key] = struct{}{}
	}
	for key := range keys {
		previousValue, hadPrevious := previous[key]
		currentValue, hasCurrent := current[key]
		if hadPrevious == hasCurrent && reflect.DeepEqual(previousValue, currentValue) {
			continue
		}
		if !hasCurrent {
			currentValue = nil
		}
		broadcastSharedWSSettings(key, currentValue)
	}
}

func syncSharedWSSettingsToClient(client *sharedWSClient) {
	store, err := utils.GetAllSettingsValues()
	if err != nil {
		return
	}
	for key, value := range store {
		sendSharedWSJSON(client, map[string]any{
			"scope": "settings",
			"type":  "sync",
			"key":   key,
			"value": value,
		})
	}
}

func ReloadSharedWSSettings() error {
	reloaded, err := utils.ReloadSettingsStore()
	if err != nil {
		return err
	}
	broadcastSharedWSSettingsSnapshot(
		map[string]any(reloaded.Previous),
		map[string]any(reloaded.Current),
	)
	return nil
}

func startSharedWSFrontendStorageWatcher() {
	sharedWSSettingsWatcher.Lock()
	defer sharedWSSettingsWatcher.Unlock()

	if sharedWSSettingsWatcher.watcher != nil {
		return
	}

	filePath := config.FrontendStorageFilePath()
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Println("Error creating frontend settings store dir:", err)
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		fmt.Println("Error creating frontend settings store watcher:", err)
		return
	}
	if err := watcher.Add(dir); err != nil {
		fmt.Println("Error watching frontend settings store dir:", err)
		_ = watcher.Close()
		return
	}

	sharedWSSettingsWatcher.watcher = watcher
	go watchSharedWSFrontendStorage(watcher, filepath.Base(filePath))
}

func stopSharedWSFrontendStorageWatcher() {
	sharedWSSettingsWatcher.Lock()
	watcher := sharedWSSettingsWatcher.watcher
	sharedWSSettingsWatcher.watcher = nil
	sharedWSSettingsWatcher.Unlock()

	if watcher != nil {
		_ = watcher.Close()
	}
}

func watchSharedWSFrontendStorage(watcher *fsnotify.Watcher, filename string) {
	var timer *time.Timer
	var timerC <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()

	scheduleReload := func() {
		if timer != nil {
			timer.Stop()
		}
		timer = time.NewTimer(sharedWSFrontendStorageWatchDebounce)
		timerC = timer.C
	}

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if filepath.Base(event.Name) != filename {
				continue
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
				continue
			}
			scheduleReload()
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			fmt.Println("Error watching frontend settings store:", err)
		case <-timerC:
			timerC = nil
			timer = nil
			if err := ReloadSharedWSSettings(); err != nil {
				fmt.Println("Error reloading frontend settings:", err)
			}
		}
	}
}
