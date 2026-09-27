"use client";

import { useEffect, useState, useRef } from "react";
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
    case "CASE": return "#1e293b"; // slate-800
    case "DOCUMENT": return "#0284c7"; // sky-600
    case "DOCUMENT_REVISION": return "#38bdf8"; // sky-400
    case "EVIDENCE": return "#b91c1c"; // red-700
    case "DERIVED_ARTIFACT": return "#f97316"; // orange-500
    case "FORENSIC_REQUEST": return "#7e22ce"; // purple-700
    case "FORENSIC_REPORT": return "#a855f7"; // purple-500
    default: return "#64748b"; // slate-500
  }
}

export function EvidenceGraph({ caseId }: { caseId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    apiFetch<GraphData>(`/api/cases/${caseId}/relationship-graph`)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiClientError ? err.message : "Failed to load graph");
        setLoading(false);
      });
  }, [caseId]);

  if (loading) return <div className="p-8 text-center text-muted">Loading graph data...</div>;
  if (error) return <div className="p-8 text-center text-danger">{error}</div>;
  if (!data) return null;

  // Simple Layered Layout
  const layers: Record<string, number> = {
    "CASE": 0,
    "DOCUMENT": 1,
    "EVIDENCE": 1,
    "DOCUMENT_REVISION": 2,
    "FORENSIC_REQUEST": 2,
    "DERIVED_ARTIFACT": 2,
    "FORENSIC_REPORT": 3
  };

  const levelGroups: Record<number, GraphNode[]> = {};
  data.nodes.forEach(n => {
    const lvl = layers[n.type] ?? 4;
    if (!levelGroups[lvl]) levelGroups[lvl] = [];
    levelGroups[lvl].push(n);
  });

  const nodeLayouts: Record<string, NodeLayout> = {};
  const width = 1200;
  
  Object.keys(levelGroups).forEach((levelStr) => {
    const level = parseInt(levelStr, 10);
    const nodesInLevel = levelGroups[level];
    const y = 100 + level * 200;
    const spacing = width / (nodesInLevel.length + 1);
    
    nodesInLevel.forEach((n, idx) => {
      nodeLayouts[n.id] = {
        ...n,
        x: spacing * (idx + 1),
        y
      };
    });
  });

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
        <svg 
          width="100%" 
          height="100%" 
          className="absolute inset-0"
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Draw Edges */}
            {data.edges.map(edge => {
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
                  />
                  <circle 
                    cx={(src.x + tgt.x)/2} 
                    cy={(src.y + tgt.y)/2} 
                    r={isSelected ? 8 : 4} 
                    fill={isSelected ? "#2563eb" : (isContentEdge ? "#10b981" : "#94a3b8")} 
                  />
                </g>
              );
            })}

            {/* Draw Nodes */}
            {Object.values(nodeLayouts).map(node => {
              const isSelected = selectedNode?.id === node.id;
              return (
                <g 
                  key={node.id} 
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(node); setSelectedEdge(null); }}
                  className="cursor-pointer"
                >
                  <circle 
                    r={isSelected ? 35 : 30} 
                    fill={getNodeColor(node.type)} 
                    stroke={isSelected ? "#3b82f6" : "#ffffff"} 
                    strokeWidth={isSelected ? 4 : 2}
                    className="transition-all shadow-lg"
                  />
                  <text 
                    y={45} 
                    textAnchor="middle" 
                    className="text-xs font-semibold fill-slate-700 pointer-events-none"
                  >
                    {node.name.length > 20 ? node.name.substring(0, 20) + "..." : node.name}
                  </text>
                  <text 
                    y={60} 
                    textAnchor="middle" 
                    className="text-[10px] fill-slate-500 pointer-events-none"
                  >
                    {node.type}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Controls Overlay */}
        <div className="absolute top-4 left-4 flex gap-2">
          <button className="bg-white border border-line p-2 rounded shadow-sm hover:bg-slate-50" onClick={() => setZoom(z => z * 1.2)}>+</button>
          <button className="bg-white border border-line p-2 rounded shadow-sm hover:bg-slate-50" onClick={() => setZoom(z => z * 0.8)}>-</button>
          <button className="bg-white border border-line p-2 rounded shadow-sm hover:bg-slate-50" onClick={() => { setZoom(1); setPan({x:0, y:0}); }}>Reset</button>
        </div>
      </div>

      {/* Details Panel */}
      <div className="w-80 bg-white border-l border-line p-6 overflow-y-auto">
        {selectedNode ? (
          <div>
            <h3 className="text-sm font-bold text-slate-500 mb-1">NODE SELECTED</h3>
            <h2 className="text-xl font-semibold text-navy mb-4">{selectedNode.name}</h2>
            <div className="space-y-4 text-sm">
              <div>
                <span className="block text-slate-500 text-xs uppercase">Type</span>
                <span className="font-medium">{selectedNode.type}</span>
              </div>
              <div>
                <span className="block text-slate-500 text-xs uppercase">Status</span>
                <span>{selectedNode.status || "N/A"}</span>
              </div>
              <div>
                <span className="block text-slate-500 text-xs uppercase">Connections</span>
                <span>{selectedNode.relationship_count}</span>
              </div>
              {selectedNode.date && (
                <div>
                  <span className="block text-slate-500 text-xs uppercase">Date</span>
                  <span>{new Date(selectedNode.date).toLocaleString()}</span>
                </div>
              )}
              {selectedNode.detail_url && (
                <div className="pt-4">
                  <Link href={selectedNode.detail_url} className="bg-navy text-white px-4 py-2 rounded block text-center hover:bg-navy/90">
                    Open Record
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : selectedEdge ? (
          <div>
            <h3 className="text-sm font-bold text-slate-500 mb-1">RELATIONSHIP</h3>
            <h2 className="text-lg font-semibold text-navy mb-4">{selectedEdge.relationship}</h2>
            <div className="space-y-4 text-sm">
              <div className="p-3 bg-slate-50 rounded border border-line">
                <span className="block text-slate-500 text-xs uppercase mb-1">What is connected?</span>
                <span className="block mb-2 font-medium">{nodeLayouts[selectedEdge.source]?.name}</span>
                <span className="block text-center text-slate-400">↓</span>
                <span className="block mt-2 font-medium">{nodeLayouts[selectedEdge.target]?.name}</span>
              </div>
              
              <div className="p-3 bg-blue-50 text-blue-900 rounded border border-blue-100">
                <span className="block text-blue-600 text-xs uppercase mb-1">Why is it connected?</span>
                <p>{selectedEdge.explanation}</p>
              </div>

              <div>
                <span className="block text-slate-500 text-xs uppercase mb-1">Source of relationship</span>
                <p className="text-slate-600">
                  {selectedEdge.relationship === "SHARED_IDENTIFIER" 
                    ? "Indexed document content (Search subsystem)" 
                    : "Database relationship / Provenance trace"}
                </p>
              </div>

              {selectedEdge.relationship === "SHARED_IDENTIFIER" && (
                <div className="pt-4 border-t border-line">
                  <p className="text-xs text-muted mb-3">You can use the AI Assistant to query the context of these related documents.</p>
                  <Link href="/assistant" className="bg-navy text-white px-4 py-2 rounded block text-center hover:bg-navy/90">
                    Ask Assistant
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-4 text-slate-300">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <p>Select a node or connection in the graph to view its details and explanation.</p>
          </div>
        )}
      </div>
    </div>
  );
}
