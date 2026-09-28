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

function getNodeColor(type: string) {
  switch (type) {
    case "CASE": return "bg-slate-800 text-white border-slate-900";
    case "DOCUMENT": return "bg-sky-600 text-white border-sky-700";
    case "DOCUMENT_REVISION": return "bg-sky-200 text-slate-800 border-sky-300";
    case "EVIDENCE": return "bg-red-700 text-white border-red-800";
    case "DERIVED_ARTIFACT": return "bg-orange-500 text-white border-orange-600";
    case "FORENSIC_REQUEST": return "bg-purple-700 text-white border-purple-800";
    case "FORENSIC_REPORT": return "bg-violet-500 text-white border-violet-600";
    default: return "bg-slate-500 text-white border-slate-600";
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

function getFriendlyType(type: string) {
  return type.replace(/_/g, " ");
}

export function EvidenceGraph({ caseId }: { caseId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // UX State
  const [history, setHistory] = useState<string[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // Right panel state
  const [inspectedEntityId, setInspectedEntityId] = useState<string | null>(null);
  const [inspectedEdgeId, setInspectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<GraphData>(`/api/cases/${caseId}/relationship-graph`)
      .then((res) => {
        if (!active) return;
        setData(res);
        setLoading(false);
        const caseNode = res.nodes.find(n => n.type === "CASE");
        if (caseNode) {
          setHistory([caseNode.id]);
          setSelectedEntityId(caseNode.id);
          setInspectedEntityId(caseNode.id);
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

  const focusNode = useMemo(() => {
    if (!data || !selectedEntityId) return null;
    return data.nodes.find(n => n.id === selectedEntityId) || null;
  }, [data, selectedEntityId]);

  // Handle focusing a new node
  const handleFocus = (nodeId: string) => {
    if (selectedEntityId === nodeId) return;
    setHistory(prev => {
      const idx = prev.indexOf(nodeId);
      if (idx !== -1) return prev.slice(0, idx + 1); // Truncate history if navigating back
      return [...prev, nodeId];
    });
    setSelectedEntityId(nodeId);
    setInspectedEntityId(nodeId);
    setInspectedEdgeId(null);
  };

  const handleBreadcrumbClick = (nodeId: string) => {
    const idx = history.indexOf(nodeId);
    if (idx !== -1) {
      setHistory(history.slice(0, idx + 1));
      setSelectedEntityId(nodeId);
      setInspectedEntityId(nodeId);
      setInspectedEdgeId(null);
    }
  };

  const toggleGroup = (groupType: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupType)) next.delete(groupType);
      else next.add(groupType);
      return next;
    });
  };

  // Grouped relationships for center view
  const relationshipGroups = useMemo(() => {
    if (!data || !focusNode) return [];
    
    // Find all edges connected to focusNode
    const connectedEdges = data.edges.filter(e => e.source === focusNode.id || e.target === focusNode.id);
    
    const grouped: Record<string, { nodes: GraphNode[], edgeIds: string[] }> = {};
    
    connectedEdges.forEach(edge => {
      const neighborId = edge.source === focusNode.id ? edge.target : edge.source;
      const neighbor = data.nodes.find(n => n.id === neighborId);
      if (!neighbor) return;
      
      // Filter logic
      if (neighbor.type === "DOCUMENT_REVISION") return;
      if (filterType && neighbor.type !== filterType && filterType !== "ALL") return;
      
      if (!grouped[neighbor.type]) grouped[neighbor.type] = { nodes: [], edgeIds: [] };
      if (!grouped[neighbor.type].nodes.some(n => n.id === neighbor.id)) {
        grouped[neighbor.type].nodes.push(neighbor);
        grouped[neighbor.type].edgeIds.push(edge.id);
      }
    });
    
    return Object.entries(grouped).map(([type, payload]) => ({
      type,
      nodes: payload.nodes,
      edgeIds: payload.edgeIds
    })).sort((a, b) => b.nodes.length - a.nodes.length);
  }, [data, focusNode, filterType]);

  // Search Results
  const searchResults = useMemo(() => {
    if (!data || searchQuery.trim().length < 2) return [];
    const query = searchQuery.toLowerCase();
    return data.nodes.filter(n => 
      n.name.toLowerCase().includes(query) || 
      n.type.toLowerCase().includes(query)
    ).slice(0, 10);
  }, [data, searchQuery]);

  // Detail panel node/edge
  const inspectedNode = data?.nodes.find(n => n.id === inspectedEntityId) || null;
  const inspectedEdge = data?.edges.find(e => e.id === inspectedEdgeId) || null;

  if (loading) return <div className="p-8 text-center text-slate-500">Loading graph data...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;
  if (!data) return null;

  const totalEntities = data.nodes.length;
  const totalEdges = data.edges.length;
  const evidenceCount = data.nodes.filter(n => n.type === "EVIDENCE").length;

  return (
    <div className="flex flex-col h-[85vh] bg-slate-50 border border-line rounded-lg overflow-hidden shadow-sm">
      {/* TOP HEADER */}
      <div className="p-4 bg-white border-b border-line flex flex-col md:flex-row justify-between items-center gap-4 z-10 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-navy tracking-tight">Evidence Mapping</h1>
          <p className="text-sm text-slate-500">Case {focusNode?.case_number || caseId}</p>
        </div>
        
        <div className="flex gap-4 items-center text-sm bg-slate-50 px-4 py-2 rounded-full border border-slate-200">
          <div className="text-slate-600"><b className="text-navy">{totalEntities}</b> Entities</div>
          <div className="w-px h-4 bg-slate-300"></div>
          <div className="text-slate-600"><b className="text-navy">{totalEdges}</b> Relationships</div>
          <div className="w-px h-4 bg-slate-300"></div>
          <div className="text-slate-600"><b className="text-navy">{evidenceCount}</b> Evidence Items</div>
        </div>

        <div className="relative w-full md:w-64">
          <input 
            type="search" 
            placeholder="Search entities (e.g. TXN-998877)..." 
            className="w-full border border-slate-300 p-2 pl-8 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto z-50">
              {searchResults.map(res => (
                <div 
                  key={res.id} 
                  className="p-2 hover:bg-slate-50 border-b border-slate-100 cursor-pointer flex items-center gap-2"
                  onClick={() => { handleFocus(res.id); setSearchQuery(""); }}
                >
                  <span className="text-xs">{getIcon(res.type)}</span>
                  <div className="overflow-hidden">
                    <div className="text-xs font-bold text-navy truncate">{res.name}</div>
                    <div className="text-[10px] text-slate-500">{getFriendlyType(res.type)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* FILTERS */}
      <div className="bg-white border-b border-line px-4 py-2 flex items-center gap-2 overflow-x-auto text-sm z-10">
        <span className="text-slate-500 font-medium mr-2 text-xs uppercase">Filters:</span>
        <button onClick={() => setFilterType(null)} className={`px-3 py-1 rounded-full border transition-colors ${!filterType ? 'bg-navy text-white border-navy' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`}>All</button>
        <button onClick={() => setFilterType("DOCUMENT")} className={`px-3 py-1 rounded-full border transition-colors ${filterType === "DOCUMENT" ? 'bg-sky-600 text-white border-sky-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`}>Documents</button>
        <button onClick={() => setFilterType("EVIDENCE")} className={`px-3 py-1 rounded-full border transition-colors ${filterType === "EVIDENCE" ? 'bg-red-700 text-white border-red-800' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`}>Evidence</button>
        <button onClick={() => setFilterType("DERIVED_ARTIFACT")} className={`px-3 py-1 rounded-full border transition-colors ${filterType === "DERIVED_ARTIFACT" ? 'bg-orange-500 text-white border-orange-600' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`}>Artifacts</button>
        <button onClick={() => setFilterType("FORENSIC_REQUEST")} className={`px-3 py-1 rounded-full border transition-colors ${filterType === "FORENSIC_REQUEST" ? 'bg-purple-700 text-white border-purple-800' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`}>Forensic Requests</button>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* LEFT HIERARCHY / PROVENANCE TREE */}
        <div className="w-1/4 min-w-[250px] bg-white border-r border-line overflow-y-auto hidden lg:block">
          <div className="p-4 bg-slate-50 border-b border-slate-200 sticky top-0 font-semibold text-slate-700 text-sm uppercase tracking-wider">
            Case Hierarchy
          </div>
          <div className="p-4 space-y-2">
            {/* Compute a quick top-level tree for the left panel based on CASE nodes */}
            {data.nodes.filter(n => n.type === "CASE").map(caseNode => {
              const docs = data.edges.filter(e => e.source === caseNode.id && data.nodes.find(n => n.id === e.target)?.type === "DOCUMENT");
              const evds = data.edges.filter(e => e.source === caseNode.id && data.nodes.find(n => n.id === e.target)?.type === "EVIDENCE");
              
              return (
                <div key={caseNode.id} className="text-sm">
                  <div 
                    className={`font-bold flex items-center gap-2 p-2 rounded cursor-pointer ${selectedEntityId === caseNode.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-800'}`}
                    onClick={() => handleFocus(caseNode.id)}
                  >
                    {getIcon("CASE")} Case Context
                  </div>
                  <div className="ml-4 pl-2 border-l border-slate-200 mt-2 space-y-4">
                    
                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">DOCUMENTS ({docs.length})</div>
                      {docs.slice(0, 5).map(e => {
                        const n = data.nodes.find(x => x.id === e.target)!;
                        return (
                          <div 
                            key={n.id} 
                            className={`truncate py-1 px-2 rounded cursor-pointer text-xs ${selectedEntityId === n.id ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-100 text-slate-600'}`}
                            onClick={() => handleFocus(n.id)}
                          >
                            {getIcon(n.type)} {n.name}
                          </div>
                        )
                      })}
                      {docs.length > 5 && <div className="text-xs text-blue-500 pl-2 pt-1">+{docs.length - 5} more</div>}
                    </div>

                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">EVIDENCE ({evds.length})</div>
                      {evds.slice(0, 5).map(e => {
                        const n = data.nodes.find(x => x.id === e.target)!;
                        return (
                          <div 
                            key={n.id} 
                            className={`truncate py-1 px-2 rounded cursor-pointer text-xs ${selectedEntityId === n.id ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-100 text-slate-600'}`}
                            onClick={() => handleFocus(n.id)}
                          >
                            {getIcon(n.type)} {n.name}
                          </div>
                        )
                      })}
                      {evds.length > 5 && <div className="text-xs text-blue-500 pl-2 pt-1">+{evds.length - 5} more</div>}
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* CENTER FOCUSED VIEW */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 flex flex-col relative" id="center-canvas">
          
          {/* Breadcrumbs */}
          <div className="p-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white sticky top-0 z-20 shadow-sm">
            {history.map((id, idx) => {
              const node = data.nodes.find(n => n.id === id);
              if (!node) return null;
              const isLast = idx === history.length - 1;
              return (
                <div key={`${id}-${idx}`} className="flex items-center gap-2">
                  <div 
                    onClick={() => handleBreadcrumbClick(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors border
                      ${isLast 
                        ? 'bg-blue-50 text-blue-700 border-blue-200' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}
                  >
                    <span>{getIcon(node.type)}</span>
                    <span className="truncate max-w-[150px]">{node.name.split(':')[0]}</span>
                  </div>
                  {!isLast && <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>}
                </div>
              );
            })}
          </div>

          <div className="flex-1 p-8 flex flex-col items-center min-h-max pb-24 relative transition-all duration-300">
            {focusNode ? (
              <div className="flex flex-col items-center w-full max-w-5xl mx-auto animate-in fade-in zoom-in-95 duration-200">
                
                {/* 1. FOCUS NODE (Center Stage) */}
                <div className="mb-8 relative z-10">
                  <div 
                    className={`w-80 bg-white rounded-xl shadow-lg border-2 border-blue-400 overflow-hidden text-left flex flex-col transition-shadow hover:shadow-xl ring-4 ring-blue-50 cursor-pointer`}
                    onClick={() => { setInspectedEntityId(focusNode.id); setInspectedEdgeId(null); }}
                  >
                    <div className={`px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${getNodeColor(focusNode.type)}`}>
                      <span className="text-lg">{getIcon(focusNode.type)}</span>
                      <span>{getFriendlyType(focusNode.type)}</span>
                    </div>
                    <div className="p-4">
                      <div className="font-bold text-navy mb-1 leading-snug">{focusNode.name}</div>
                      <div className="text-xs text-slate-500 font-medium mb-3">{focusNode.status || 'UNKNOWN STATUS'}</div>
                      <div className="flex justify-between items-center text-xs border-t border-slate-100 pt-3">
                        <span className="text-slate-500 bg-slate-50 px-2 py-1 rounded font-medium">{focusNode.relationship_count} relationships</span>
                        <span className="text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded">Current Focus</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Vertical line down from focus node */}
                {relationshipGroups.length > 0 && (
                  <div className="w-px h-12 bg-slate-300 -mt-8 mb-4 relative z-0"></div>
                )}

                {/* 2. HIERARCHICAL RELATIONSHIPS */}
                <div className="flex flex-wrap justify-center gap-x-8 gap-y-12 relative w-full pt-4">
                  {/* Horizontal connector line for children groups */}
                  {relationshipGroups.length > 1 && (
                    <div className="absolute top-0 left-1/4 right-1/4 h-px bg-slate-300 hidden md:block"></div>
                  )}

                  {relationshipGroups.map((group, gIdx) => {
                    const isExpanded = expandedGroups.has(group.type);
                    const visibleNodes = isExpanded ? group.nodes : group.nodes.slice(0, 5);
                    const hasMore = group.nodes.length > 5;
                    
                    return (
                      <div key={group.type} className="flex flex-col items-center relative min-w-[280px] max-w-[320px]">
                        {/* Vertical line connecting to group */}
                        <div className="absolute -top-4 w-px h-4 bg-slate-300 hidden md:block"></div>

                        {/* Group Header */}
                        <div 
                          className="bg-white border border-slate-200 shadow-sm px-4 py-2 rounded-full text-xs font-bold text-slate-700 flex items-center gap-2 mb-6 cursor-pointer hover:bg-slate-50 z-10 transition-colors"
                          onClick={() => toggleGroup(group.type)}
                        >
                          <span className="text-base">{getIcon(group.type)}</span>
                          {getFriendlyType(group.type)}
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full ml-1">{group.nodes.length}</span>
                        </div>

                        {/* Nodes in Group */}
                        <div className="flex flex-col w-full gap-3 relative">
                          {/* Main trunk line for group */}
                          <div className="absolute top-0 bottom-6 left-6 w-px bg-slate-200 z-0"></div>

                          {visibleNodes.map((node, nIdx) => {
                            const edgeId = group.edgeIds[nIdx];
                            const isInspected = inspectedEntityId === node.id || inspectedEdgeId === edgeId;
                            
                            return (
                              <div key={node.id} className="relative z-10 pl-12">
                                {/* Branch line to card */}
                                <div className="absolute top-1/2 -mt-px left-6 w-6 h-px bg-slate-200"></div>

                                <div 
                                  className={`bg-white border rounded-lg shadow-sm overflow-hidden flex flex-col cursor-pointer transition-all hover:shadow-md hover:border-blue-400
                                    ${isInspected ? 'border-blue-500 ring-1 ring-blue-500 shadow-md' : 'border-slate-200'}`}
                                  onClick={() => { setInspectedEntityId(node.id); setInspectedEdgeId(edgeId); }}
                                >
                                  <div className="p-3 flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold text-sm text-navy truncate" title={node.name}>{node.name}</div>
                                      <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">{node.status}</div>
                                      {/* Relationship Explanation */}
                                      <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-100 leading-snug">
                                        <span className="font-semibold text-slate-400 mr-1">{data.edges.find(e => e.id === edgeId)?.relationship}:</span>
                                        {data.edges.find(e => e.id === edgeId)?.explanation}
                                      </div>
                                    </div>
                                    
                                    {/* Action button */}
                                    <button 
                                      className="shrink-0 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs px-2 py-1.5 rounded font-medium transition-colors"
                                      onClick={(e) => { e.stopPropagation(); handleFocus(node.id); }}
                                    >
                                      Focus
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Show More Button */}
                          {hasMore && (
                            <div className="pl-12 mt-2 relative z-10">
                              <button 
                                className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
                                onClick={() => toggleGroup(group.type)}
                              >
                                {isExpanded ? 'Show Less' : `Show All ${group.nodes.length}`}
                                <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {relationshipGroups.length === 0 && (
                  <div className="text-center p-8 bg-white border border-dashed border-slate-300 rounded-lg max-w-md w-full">
                    <div className="text-slate-400 mb-2">
                      <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                    </div>
                    <h3 className="font-medium text-slate-700">No Direct Relationships</h3>
                    <p className="text-sm text-slate-500 mt-1">This entity does not have any direct connections to other items in the graph.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="m-auto text-slate-400">Select an entity to focus...</div>
            )}
          </div>
        </div>

        {/* RIGHT DETAILS PANEL */}
        <div className="w-[360px] min-w-[360px] bg-white border-l border-line overflow-y-auto flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-30">
          
          {inspectedEdge && (
            <div className="p-5 border-b border-blue-100 bg-blue-50/50">
              <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-2">Relationship Explanation</div>
              <h3 className="font-bold text-navy mb-2">{inspectedEdge.relationship}</h3>
              <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-md border border-blue-100 shadow-sm">
                "{inspectedEdge.explanation}"
              </p>
            </div>
          )}

          {inspectedNode ? (
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">{getIcon(inspectedNode.type)}</span>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{getFriendlyType(inspectedNode.type)}</div>
              </div>
              
              <h2 className="text-xl font-bold text-navy leading-tight mb-4">{inspectedNode.name}</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Status</div>
                  <div className="font-medium text-sm text-slate-800">{inspectedNode.status || 'N/A'}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Connections</div>
                  <div className="font-medium text-sm text-slate-800">{inspectedNode.relationship_count}</div>
                </div>
                {inspectedNode.date && (
                  <div className="col-span-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Recorded Date</div>
                    <div className="font-medium text-sm text-slate-800">{new Date(inspectedNode.date).toLocaleString()}</div>
                  </div>
                )}
              </div>

              {inspectedNode.detail_url && (
                <Link 
                  href={inspectedNode.detail_url} 
                  className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-navy hover:bg-navy/90 text-white rounded-lg font-medium text-sm transition-colors shadow-sm mb-8"
                >
                  Open Complete Record
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                </Link>
              )}

              {/* Provenance Chain Concept for Evidence/Artifacts */}
              {(inspectedNode.type === "EVIDENCE" || inspectedNode.type === "DERIVED_ARTIFACT" || inspectedNode.type === "FORENSIC_REPORT") && (
                <div className="mt-8 border-t border-slate-200 pt-6">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                    Provenance Chain
                  </h3>
                  
                  <div className="relative pl-4 space-y-4">
                    <div className="absolute top-2 bottom-2 left-[5px] w-0.5 bg-slate-200 rounded-full"></div>
                    
                    {data.edges
                      .filter(e => e.target === inspectedNode.id)
                      .map(edge => {
                        const sourceNode = data.nodes.find(n => n.id === edge.source);
                        if (!sourceNode) return null;
                        return (
                          <div key={`prov-${edge.id}`} className="relative">
                            <div className="absolute top-2 -left-4 w-2 h-2 rounded-full bg-slate-400 border-2 border-white ring-1 ring-slate-200"></div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">{edge.relationship} from</div>
                            <div 
                              className="text-sm font-medium text-blue-600 hover:underline cursor-pointer truncate"
                              onClick={() => { setInspectedEntityId(sourceNode.id); setInspectedEdgeId(null); }}
                            >
                              {sourceNode.name}
                            </div>
                          </div>
                        );
                      })
                    }
                    
                    <div className="relative">
                      <div className="absolute top-2 -left-4 w-2 h-2 rounded-full bg-blue-500 border-2 border-white ring-1 ring-blue-200"></div>
                      <div className="text-[10px] font-bold text-blue-600 uppercase mb-0.5">Current Entity</div>
                      <div className="text-sm font-bold text-navy truncate">{inspectedNode.name}</div>
                    </div>

                    {data.edges
                      .filter(e => e.source === inspectedNode.id && (e.relationship === "PRODUCES" || e.relationship === "REPORTS"))
                      .map(edge => {
                        const targetNode = data.nodes.find(n => n.id === edge.target);
                        if (!targetNode) return null;
                        return (
                          <div key={`prov-out-${edge.id}`} className="relative">
                            <div className="absolute top-2 -left-4 w-2 h-2 rounded-full bg-slate-400 border-2 border-white ring-1 ring-slate-200"></div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">{edge.relationship}</div>
                            <div 
                              className="text-sm font-medium text-blue-600 hover:underline cursor-pointer truncate"
                              onClick={() => { setInspectedEntityId(targetNode.id); setInspectedEdgeId(null); }}
                            >
                              {targetNode.name}
                            </div>
                          </div>
                        );
                      })
                    }
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-full">
              <svg className="w-12 h-12 mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              Select an entity or relationship line to view its complete details here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
