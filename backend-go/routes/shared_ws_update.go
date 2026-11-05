package routes

import (
	"sync"

	"file-lite-go/updater"
)

// Update state is process-global: one GitHub update runs at a time and every
// connected client sees its progress.

type updateStateSnapshot struct {
	Active   bool   `json:"active"`
	Phase    string `json:"phase,omitempty"`
	Received int64  `json:"received,omitempty"`
	Total    int64  `json:"total,omitempty"`
	Percent  int    `json:"percent,omitempty"`
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
	Error    string `json:"error,omitempty"`
}

type updateEventMessage struct {
	Scope string `json:"scope"`
	Type  string `json:"type"`
	updateStateSnapshot
}

var updateRunState = struct {
	sync.Mutex
	snapshot updateStateSnapshot
}{}

func currentUpdateState() updateStateSnapshot {
	updateRunState.Lock()
	defer updateRunState.Unlock()
	return updateRunState.snapshot
}

// beginUpdate returns false when another update is already running.
func beginUpdate(from string) bool {
	updateRunState.Lock()
	defer updateRunState.Unlock()
	if updateRunState.snapshot.Active {
		return false
	}
	updateRunState.snapshot = updateStateSnapshot{Active: true, Phase: "download", From: from}
	return true
}

func broadcastUpdateProgress(progress updater.Progress) {
	updateRunState.Lock()
	snapshot := updateRunState.snapshot
	snapshot.Active = true
	snapshot.Phase = progress.Phase
	snapshot.Percent = progress.Percent
	if progress.Phase == "download" {
		snapshot.Received = progress.Received
		snapshot.Total = progress.Total
		if snapshot.Total > 0 {
			snapshot.Percent = int(progress.Received * 100 / progress.Total)
		}
	}
	updateRunState.snapshot = snapshot
	updateRunState.Unlock()

	broadcastUpdateEvent("progress", snapshot, true)
}

func broadcastUpdateDone(from, to string) {
	updateRunState.Lock()
	updateRunState.snapshot = updateStateSnapshot{Active: false, Phase: "done", Percent: 100, From: from, To: to}
	snapshot := updateRunState.snapshot
	updateRunState.Unlock()

	broadcastUpdateEvent("done", snapshot, false)
}

func broadcastUpdateError(phase, message string) {
	updateRunState.Lock()
	snapshot := updateRunState.snapshot
	snapshot.Active = false
	snapshot.Phase = phase
	snapshot.Error = message
	updateRunState.snapshot = snapshot
	updateRunState.Unlock()

	broadcastUpdateEvent("error", snapshot, false)
}

func broadcastUpdateEvent(eventType string, snapshot updateStateSnapshot, droppable bool) {
	clients := snapshotSharedWSClients()
	if len(clients) == 0 {
		return
	}
	payload := updateEventMessage{Scope: "update", Type: eventType, updateStateSnapshot: snapshot}
	for _, client := range clients {
		if droppable {
			sendSharedWSJSONDroppable(client, payload)
		} else {
			sendSharedWSJSON(client, payload)
		}
	}
}

// sendSharedWSUpdateSnapshot tells a newly connected client what is running, so
// progress that started before the connection is not lost.
func sendSharedWSUpdateSnapshot(client *sharedWSClient) {
	sendSharedWSJSON(client, updateEventMessage{
		Scope:               "update",
		Type:                "snapshot",
		updateStateSnapshot: currentUpdateState(),
	})
}
