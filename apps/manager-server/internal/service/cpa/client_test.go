package cpa

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestFetchAPIKeys(t *testing.T) {
	expectedToken := "test-mgmt-key"
	var responseEntries any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v0/management/api-keys" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+expectedToken {
			t.Errorf("unexpected auth header: %s", auth)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"api-keys": responseEntries,
		})
	}))
	defer server.Close()

	for _, tc := range []struct {
		name    string
		entries any
		wantErr bool
	}{
		{
			name:    "legacy strings",
			entries: []string{"  key-1  ", "", "key-2", "key-1", "   ", "key-3"},
		},
		{
			name: "structured and legacy entries",
			entries: []any{
				map[string]any{"api-key": "  key-1  ", "name": "Client", "cost-limits": map[string]any{"7d": 12.34}},
				nil,
				map[string]any{"api-key": "   "},
				"key-2",
				map[string]any{"api-key": "key-1"},
				map[string]any{"api-key": "key-3"},
			},
		},
		{
			name:    "invalid structured key does not leak contents",
			entries: []any{map[string]any{"api-key": []string{"sensitive-client-key"}}},
			wantErr: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			responseEntries = tc.entries
			keys, err := FetchAPIKeys(context.Background(), server.URL, expectedToken)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected invalid API key entry error")
				}
				if strings.Contains(err.Error(), "sensitive-client-key") {
					t.Fatal("invalid API key entry error exposed response contents")
				}
				return
			}
			if err != nil {
				t.Fatalf("FetchAPIKeys failed: %v", err)
			}
			expected := []string{"key-1", "key-2", "key-3"}
			if !reflect.DeepEqual(keys, expected) {
				t.Errorf("expected keys %v, got %v", expected, keys)
			}
		})
	}
}

func TestFetchModelsWithAPIKey(t *testing.T) {
	expectedToken := "client-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+expectedToken {
			t.Errorf("unexpected auth header: %s", auth)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data": []map[string]any{
				{"id": "gpt-b"},
				{"id": " gpt-a "},
				{"id": "gpt-a"},
				{"id": ""},
			},
		})
	}))
	defer server.Close()

	ctx := context.Background()
	models, err := FetchModels(ctx, server.URL, expectedToken)
	if err != nil {
		t.Fatalf("FetchModels failed: %v", err)
	}

	expected := []string{"gpt-a", "gpt-b"}
	if !reflect.DeepEqual(models, expected) {
		t.Errorf("expected models %v, got %v", expected, models)
	}
}

func TestFetchModelsAnonymous(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if auth := r.Header.Get("Authorization"); auth != "" {
			t.Errorf("expected no authorization header, got: %s", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data": []map[string]any{
				{"id": "anon-model-2"},
				{"id": "anon-model-1"},
			},
		})
	}))
	defer server.Close()

	ctx := context.Background()
	models, err := FetchModels(ctx, server.URL, "")
	if err != nil {
		t.Fatalf("FetchModels failed: %v", err)
	}

	expected := []string{"anon-model-1", "anon-model-2"}
	if !reflect.DeepEqual(models, expected) {
		t.Errorf("expected models %v, got %v", expected, models)
	}
}
