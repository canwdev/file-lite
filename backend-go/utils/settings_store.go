package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"file-lite-go/config"
)

type SettingsStoreValue = any

type settingsStoreMap map[string]SettingsStoreValue

type settingsStoreState struct {
	mu     sync.Mutex
	loaded bool
	cache  settingsStoreMap
}

var frontendSettingsStore = &settingsStoreState{}

func GetSettingsValue(key string) (SettingsStoreValue, error) {
	frontendSettingsStore.mu.Lock()
	defer frontendSettingsStore.mu.Unlock()

	if err := frontendSettingsStore.ensureLoaded(); err != nil {
		return nil, err
	}
	if value, ok := frontendSettingsStore.cache[key]; ok {
		return value, nil
	}
	return nil, nil
}

func SetSettingsValue(key string, value SettingsStoreValue) (SettingsStoreValue, error) {
	frontendSettingsStore.mu.Lock()
	defer frontendSettingsStore.mu.Unlock()

	if err := frontendSettingsStore.ensureLoaded(); err != nil {
		return nil, err
	}

	nextStore := cloneSettingsStore(frontendSettingsStore.cache)
	nextStore[key] = value
	if err := persistSettingsStore(nextStore); err != nil {
		return nil, err
	}
	frontendSettingsStore.cache = nextStore
	return value, nil
}

func DeleteSettingsValue(key string) (nilValue SettingsStoreValue, err error) {
	frontendSettingsStore.mu.Lock()
	defer frontendSettingsStore.mu.Unlock()

	if err := frontendSettingsStore.ensureLoaded(); err != nil {
		return nil, err
	}
	if _, ok := frontendSettingsStore.cache[key]; !ok {
		return nil, nil
	}

	nextStore := cloneSettingsStore(frontendSettingsStore.cache)
	delete(nextStore, key)
	if err := persistSettingsStore(nextStore); err != nil {
		return nil, err
	}
	frontendSettingsStore.cache = nextStore
	return nil, nil
}

func (s *settingsStoreState) ensureLoaded() error {
	if s.loaded {
		return nil
	}
	store, err := readSettingsStoreFile()
	if err != nil {
		return err
	}
	s.cache = store
	s.loaded = true
	return nil
}

func readSettingsStoreFile() (settingsStoreMap, error) {
	content, err := os.ReadFile(config.FrontendStorageFilePath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return settingsStoreMap{}, nil
		}
		return nil, fmt.Errorf("read frontend settings store: %w", err)
	}

	var value any
	if err := json.Unmarshal(content, &value); err != nil {
		return settingsStoreMap{}, nil
	}
	return normalizeSettingsStoreMap(value), nil
}

func normalizeSettingsStoreMap(value any) settingsStoreMap {
	if value == nil {
		return settingsStoreMap{}
	}
	store, ok := value.(map[string]any)
	if !ok {
		return settingsStoreMap{}
	}
	return settingsStoreMap(store)
}

func persistSettingsStore(store settingsStoreMap) error {
	filePath := config.FrontendStorageFilePath()
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("create frontend settings dir: %w", err)
	}
	content, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal frontend settings store: %w", err)
	}
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		return fmt.Errorf("write frontend settings store: %w", err)
	}
	return nil
}

func cloneSettingsStore(store settingsStoreMap) settingsStoreMap {
	cloned := make(settingsStoreMap, len(store))
	for key, value := range store {
		cloned[key] = value
	}
	return cloned
}
