"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ApiClientError, apiFetch } from "@/lib/api";

type GraphNode = {
  id: string;
  type: string;
  name: string;
  status: string | null;
  case_number: string | null;
  date: string | null;
  detail_url: string | null;
  relationship_count: number;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relationship: string;
  explanation: string;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type NodeLayout = GraphNode & {
  x: number;
  y: number;
};

function getNodeColor(type: string) {
  switch (type) {
    case "CASE": return "bg-slate-800 text-white";
    case "DOCUMENT": return "bg-sky-600 text-white";
    case "DOCUMENT_REVISION": return "bg-sky-400 text-slate-900";
    case "EVIDENCE": return "bg-red-700 text-white";
    case "DERIVED_ARTIFACT": return "bg-orange-500 text-white";
    case "FORENSIC_REQUEST": return "bg-purple-700 text-white";
    case "FORENSIC_REPORT": return "bg-purple-500 text-white";
    default: return "bg-slate-500 text-white";
  }
}

function getIcon(type: string) {
  switch (type) {
    case "CASE": return "📁";
    case "DOCUMENT": return "📄";
    case "DOCUMENT_REVISION": return "📑";
    case "EVIDENCE": return "🛡️";
    case "DERIVED_ARTIFACT": return "🧩";
    case "FORENSIC_REQUEST": return "🔬";
    case "FORENSIC_REPORT": return "📋";
    default: return "📌";
  }
}

export function EvidenceGraph({ caseId }: { caseId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let active = true;
    apiFetch<GraphData>(`/api/cases/${caseId}/relationship-graph`)
      .then((res) => {
        if (!active) return;
        setData(res);
        setLoading(false);
        // Find initial focus: case node or first evidence
        const caseNode = res.nodes.find(n => n.type === "CASE");
        if (caseNode) {
          setFocusNodeId(caseNode.id);
          setExpandedNodes(new Set([caseNode.id]));
          setSelectedNode(caseNode);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof ApiClientError ? err.message : "Failed to load graph");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [caseId]);

  const { visibleNodes, visibleEdges, nodeLayouts } = useMemo(() => {
    if (!data || !focusNodeId) return { visibleNodes: [], visibleEdges: [], nodeLayouts: {} };

    const levels: Record<string, number> = {};
    const visNodes = new Set<string>();
    const visEdges = new Set<string>();

    const queue: { id: string; level: number }[] = [{ id: focusNodeId, level: 0 }];
    const visited = new Set<string>();
    visNodes.add(focusNodeId);

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (!(id in levels)) {
        levels[id] = level;
      }
      visited.add(id);

      if (expandedNodes.has(id)) {
        const connectedEdges = data.edges.filter(e => e.source === id || e.target === id);
        for (const edge of connectedEdges) {
          visEdges.add(edge.id);
          const neighbor = edge.source === id ? edge.target : edge.source;
          visNodes.add(neighbor);
          if (!visited.has(neighbor) && !queue.find(q => q.id === neighbor)) {
            queue.push({ id: neighbor, level: level + 1 });
          }
        }
      }
    }

    const levelGroups: Record<number, GraphNode[]> = {};
    for (const nodeId of visNodes) {
      const lvl = levels[nodeId] || 0;
      if (!levelGroups[lvl]) levelGroups[lvl] = [];
      const node = data.nodes.find(n => n.id === nodeId);
      if (node) levelGroups[lvl].push(node);
    }

    const layouts: Record<string, NodeLayout> = {};
    const width = 1200;

    Object.keys(levelGroups).forEach((levelStr) => {
      const level = parseInt(levelStr, 10);
      const nodesInLevel = levelGroups[level];
      const y = 50 + level * 200;
      const spacing = width / (nodesInLevel.length + 1);
      
      nodesInLevel.forEach((n, idx) => {
        layouts[n.id] = {
          ...n,
          x: spacing * (idx + 1),
          y
        };
      });
    });

    return {
      visibleNodes: Array.from(visNodes).map(id => data.nodes.find(n => n.id === id)!).filter(Boolean),
      visibleEdges: Array.from(visEdges).map(id => data.edges.find(e => e.id === id)!).filter(Boolean),
      nodeLayouts: layouts
    };
  }, [data, focusNodeId, expandedNodes]);

  if (loading) return <div className="p-8 text-center text-muted">Loading graph data...</div>;
  if (error) return <div className="p-8 text-center text-danger">Error ({caseId}): {error}</div>;
  if (!data) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(0.2, prev * zoomDelta), 3));
  };

  const toggleExpand = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expandedNodes);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    setExpandedNodes(next);
  };

  const makeFocus = (node: GraphNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setFocusNodeId(node.id);
    setExpandedNodes(new Set([node.id]));
    setSelectedNode(node);
    setSelectedEdge(null);
    setPan({ x: 0, y: 0 }); // reset pan
  };

  // Helper lists for side panel
  const relatedDocuments = selectedNode ? data.edges
    .filter(e => (e.source === selectedNode.id || e.target === selectedNode.id) && 
            (data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))?.type === "DOCUMENT"))
    .map(e => ({ edge: e, node: data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))! })) : [];

  const relatedEvidence = selectedNode ? data.edges
    .filter(e => (e.source === selectedNode.id || e.target === selectedNode.id) && 
            (data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))?.type === "EVIDENCE"))
    .map(e => ({ edge: e, node: data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))! })) : [];

  const forensicActivity = selectedNode ? data.edges
    .filter(e => (e.source === selectedNode.id || e.target === selectedNode.id) && 
            (data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))?.type.startsWith("FORENSIC")))
    .map(e => ({ edge: e, node: data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))! })) : [];
    
  const derivedArtifacts = selectedNode ? data.edges
    .filter(e => (e.source === selectedNode.id || e.target === selectedNode.id) && 
            (data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))?.type === "DERIVED_ARTIFACT"))
    .map(e => ({ edge: e, node: data.nodes.find(n => n.id === (e.source === selectedNode.id ? e.target : e.source))! })) : [];

  return (
    <div className="flex h-[800px] border border-line rounded-lg overflow-hidden bg-slate-50 relative">
      <div 
        className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: '100%', height: '100%', position: 'absolute' }}>
          {/* SVG Layer for Edges */}
          <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
            {visibleEdges.map(edge => {
              const src = nodeLayouts[edge.source];
              const tgt = nodeLayouts[edge.target];
              if (!src || !tgt) return null;
              
              const isSelected = selectedEdge?.id === edge.id;
              const isContentEdge = edge.relationship === "SHARED_IDENTIFIER";

              return (
                <g key={edge.id} onClick={(e) => { e.stopPropagation(); setSelectedEdge(edge); setSelectedNode(null); }} className="cursor-pointer">
                  <line 
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke={isSelected ? "#2563eb" : (isContentEdge ? "#10b981" : "#94a3b8")}
                    strokeWidth={isSelected ? 4 : 2}
                    strokeDasharray={isContentEdge ? "5,5" : "none"}
                    className="transition-all"
                  />
                  {/* Edge label background */}
                  <rect 
                    x={(src.x + tgt.x)/2 - 10} 
                    y={(src.y + tgt.y)/2 - 10} 
                    width={20} height={20} 
                    fill="#ffffff" 
                    rx={10} 
                    stroke={isSelected ? "#2563eb" : "#94a3b8"}
                  />
                  <text 
                    x={(src.x + tgt.x)/2} 
                    y={(src.y + tgt.y)/2 + 4} 
                    textAnchor="middle" 
                    fontSize="10" 
                    fill={isSelected ? "#2563eb" : "#475569"}
                    className="font-bold pointer-events-none"
                  >
                    i
                  </text>
                </g>
              );
            })}
          </svg>

          {/* HTML Layer for Nodes */}
          {visibleNodes.map(node => {
            const layout = nodeLayouts[node.id];
            if (!layout) return null;
            const isSelected = selectedNode?.id === node.id;
            const isFocus = focusNodeId === node.id;
            const isExpanded = expandedNodes.has(node.id);
            const hasHiddenEdges = data.edges.some(e => (e.source === node.id || e.target === node.id) && !visibleEdges.some(ve => ve.id === e.id));

            return (
              <div 
                key={node.id} 
                className={`absolute w-56 -ml-28 -mt-10 bg-white rounded-lg shadow-md border-2 transition-all cursor-pointer select-none
                  ${isSelected ? 'border-blue-500 shadow-lg scale-105 z-10' : 'border-slate-200 hover:border-blue-300 z-0'}
                  ${isFocus ? 'ring-4 ring-blue-100' : ''}
                `}
                style={{ left: layout.x, top: layout.y }}
                onClick={(e) => { e.stopPropagation(); setSelectedNode(node); setSelectedEdge(null); }}
                onDoubleClick={(e) => makeFocus(node, e)}
              >
                <div className={`p-2 rounded-t-md text-xs font-bold uppercase tracking-wider flex items-center justify-between ${getNodeColor(node.type)}`}>
                  <span>{getIcon(node.type)} {node.type.replace("_", " ")}</span>
                  {hasHiddenEdges && (
                    <button 
                      onClick={(e) => toggleExpand(node.id, e)}
                      className="bg-white/20 hover:bg-white/40 rounded px-1"
                      title={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? "-" : "+"}
                    </button>
                  )}
                </div>
                <div className="p-3 text-center">
                  <div className="text-sm font-semibold text-slate-800 line-clamp-2" title={node.name}>{node.name}</div>
                  <div className="text-xs text-slate-500 mt-1">{node.status || "UNKNOWN"}</div>
                </div>
                {isSelected && (
                  <div className="bg-slate-50 p-2 rounded-b-md text-xs text-center border-t border-slate-100">
                    <button onClick={(e) => makeFocus(node, e)} className="text-blue-600 hover:underline font-medium">Focus Here</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Controls Overlay */}
        <div className="absolute top-4 left-4 flex gap-2">
          <button className="bg-white border border-line p-2 rounded shadow-sm hover:bg-slate-50" onClick={() => setZoom(z => z * 1.2)}>+</button>
          <button className="bg-white border border-line p-2 rounded shadow-sm hover:bg-slate-50" onClick={() => setZoom(z => z * 0.8)}>-</button>
          <button className="bg-white border border-line p-2 rounded shadow-sm hover:bg-slate-50" onClick={() => { setZoom(1); setPan({x:0, y:0}); }}>Reset View</button>
        </div>
      </div>

      {/* Details Panel */}
      <div className="w-96 bg-white border-l border-line p-6 overflow-y-auto">
        {selectedNode ? (
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-line pb-1">Entity Details</h3>
            <div className="flex items-start gap-3 mb-4">
              <div className={`mt-1 p-2 rounded-md ${getNodeColor(selectedNode.type)}`}>
                {getIcon(selectedNode.type)}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-navy leading-tight">{selectedNode.name}</h2>
                <span className="text-xs text-slate-500">{selectedNode.type.replace("_", " ")}</span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm mb-6 bg-slate-50 p-4 rounded-md border border-line">
              <div>
                <span className="block text-slate-500 text-xs uppercase">Status</span>
                <span className="font-medium">{selectedNode.status || "N/A"}</span>
              </div>
              <div>
                <span className="block text-slate-500 text-xs uppercase">Case</span>
                <span className="font-medium">{selectedNode.case_number}</span>
              </div>
              {selectedNode.date && (
                <div className="col-span-2">
                  <span className="block text-slate-500 text-xs uppercase">Created At</span>
                  <span>{new Date(selectedNode.date).toLocaleString()}</span>
                </div>
              )}
            </div>

            {selectedNode.detail_url && (
              <div className="mb-8">
                <Link href={selectedNode.detail_url} className="bg-navy text-white px-4 py-2 rounded-md w-full block text-center hover:bg-navy/90 shadow-sm transition-colors font-medium">
                  Open Complete Record
                </Link>
              </div>
            )}

            {/* Related Documents */}
            {relatedDocuments.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-line pb-1">Related Documents</h3>
                <div className="space-y-3">
                  {relatedDocuments.map((item) => (
                    <div key={item.edge.id} className="p-3 border border-slate-200 rounded-md bg-white shadow-sm hover:border-blue-300 cursor-pointer" onClick={(e) => makeFocus(item.node, e as any)}>
                      <div className="font-medium text-sm text-navy mb-1">{item.node.name}</div>
                      <div className="text-xs text-slate-500 mb-2">{item.node.status}</div>
                      <div className="text-xs bg-slate-100 p-2 rounded text-slate-700 italic border border-slate-200">
                        "{item.edge.explanation}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Evidence */}
            {relatedEvidence.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-line pb-1">Related Evidence</h3>
                <div className="space-y-3">
                  {relatedEvidence.map((item) => (
                    <div key={item.edge.id} className="p-3 border border-slate-200 rounded-md bg-white shadow-sm hover:border-blue-300 cursor-pointer" onClick={(e) => makeFocus(item.node, e as any)}>
                      <div className="font-medium text-sm text-navy mb-1">{item.node.name}</div>
                      <div className="text-xs text-slate-500 mb-2">{item.node.status}</div>
                      <div className="text-xs bg-slate-100 p-2 rounded text-slate-700 italic border border-slate-200">
                        "{item.edge.explanation}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Derived Artifacts */}
            {derivedArtifacts.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-line pb-1">Derived Artifacts</h3>
                <div className="space-y-3">
                  {derivedArtifacts.map((item) => (
                    <div key={item.edge.id} className="p-3 border border-orange-200 rounded-md bg-orange-50 shadow-sm hover:border-orange-400 cursor-pointer" onClick={(e) => makeFocus(item.node, e as any)}>
                      <div className="font-medium text-sm text-orange-900 mb-1">{item.node.name}</div>
                      <div className="text-xs text-orange-700 mb-2">{item.node.status}</div>
                      <div className="text-xs bg-white p-2 rounded text-orange-800 italic border border-orange-100">
                        "{item.edge.explanation}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Forensic Activity */}
            {forensicActivity.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-line pb-1">Forensic Activity</h3>
                <div className="space-y-3">
                  {forensicActivity.map((item) => (
                    <div key={item.edge.id} className="p-3 border border-purple-200 rounded-md bg-purple-50 shadow-sm hover:border-purple-400 cursor-pointer" onClick={(e) => makeFocus(item.node, e as any)}>
                      <div className="font-medium text-sm text-purple-900 mb-1">{item.node.name}</div>
                      <div className="text-xs text-purple-700 mb-2">{item.node.status}</div>
                      <div className="text-xs bg-white p-2 rounded text-purple-800 italic border border-purple-100">
                        "{item.edge.explanation}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        ) : selectedEdge ? (
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-line pb-1">Relationship</h3>
            <h2 className="text-lg font-semibold text-navy mb-4">{selectedEdge.relationship}</h2>
            
            <div className="space-y-6 text-sm">
              <div className="p-4 bg-slate-50 rounded-md border border-line shadow-sm relative">
                <span className="absolute -top-2 left-4 bg-white px-2 text-slate-500 text-[10px] font-bold uppercase">Target Entities</span>
                <div className="flex flex-col items-center">
                  <div className="text-center font-medium w-full p-2 bg-white rounded border border-slate-200">{nodeLayouts[selectedEdge.source]?.name}</div>
                  <div className="py-2 text-slate-400">↓</div>
                  <div className="text-center font-medium w-full p-2 bg-white rounded border border-slate-200">{nodeLayouts[selectedEdge.target]?.name}</div>
                </div>
              </div>
              
              <div className="p-4 bg-blue-50 text-blue-900 rounded-md border border-blue-200 shadow-sm relative">
                <span className="absolute -top-2 left-4 bg-blue-50 px-2 text-blue-600 text-[10px] font-bold uppercase">Explanation</span>
                <p className="mt-2 leading-relaxed">{selectedEdge.explanation}</p>
              </div>

              <div className="px-1">
                <span className="block text-slate-500 text-xs font-bold uppercase mb-1">Source of relationship</span>
                <p className="text-slate-600 bg-white">
                  {selectedEdge.relationship === "SHARED_IDENTIFIER" 
                    ? "Indexed document content (Search subsystem)" 
                    : "Database relationship / Provenance trace"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-6">
            <div className="bg-slate-100 p-4 rounded-full mb-4 border border-line">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </div>
            <h3 className="font-semibold text-slate-700 mb-2">Explore Relationships</h3>
            <p className="text-sm">Select a node or connection in the graph to view its detailed explanation and related items.</p>
            <p className="text-sm mt-4 text-blue-600 bg-blue-50 p-2 rounded w-full">Double-click any node to center the graph around it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
