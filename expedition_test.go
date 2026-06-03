package main

import "testing"

func TestValidateExpeditionGraphAcceptsConnectedGraph(t *testing.T) {
	nodes := []expeditionNode{
		{ClientID: 1, IsStart: true, PosX: 0.40, PosY: 0.40},
		{ClientID: 2, PosX: 0.50, PosY: 0.46},
		{ClientID: 3, PosX: 0.58, PosY: 0.52},
	}
	edges := []expeditionEdge{
		{AClientID: 1, BClientID: 2},
		{AClientID: 2, BClientID: 3},
	}
	if err := validateExpeditionGraph(nodes, edges); err != nil {
		t.Fatalf("expected connected graph to validate, got %v", err)
	}
}

func TestValidateExpeditionGraphRejectsIsolatedNode(t *testing.T) {
	nodes := []expeditionNode{
		{ClientID: 1, IsStart: true, PosX: 0.40, PosY: 0.40},
		{ClientID: 2, PosX: 0.50, PosY: 0.46},
	}
	if err := validateExpeditionGraph(nodes, nil); err == nil {
		t.Fatal("expected isolated node validation error")
	}
}

func TestValidateExpeditionGraphRejectsDisconnectedComponent(t *testing.T) {
	nodes := []expeditionNode{
		{ClientID: 1, IsStart: true, PosX: 0.40, PosY: 0.40},
		{ClientID: 2, PosX: 0.50, PosY: 0.46},
		{ClientID: 3, PosX: 0.56, PosY: 0.52},
		{ClientID: 4, PosX: 0.60, PosY: 0.58},
	}
	edges := []expeditionEdge{
		{AClientID: 1, BClientID: 2},
		{AClientID: 3, BClientID: 4},
	}
	if err := validateExpeditionGraph(nodes, edges); err == nil {
		t.Fatal("expected disconnected graph validation error")
	}
}

func TestValidateExpeditionGraphRejectsLongEdge(t *testing.T) {
	nodes := []expeditionNode{
		{ClientID: 1, IsStart: true, PosX: 0.20, PosY: 0.20},
		{ClientID: 2, PosX: 0.75, PosY: 0.60},
	}
	edges := []expeditionEdge{{AClientID: 1, BClientID: 2}}
	if err := validateExpeditionGraph(nodes, edges); err == nil {
		t.Fatal("expected long-edge validation error")
	}
}
