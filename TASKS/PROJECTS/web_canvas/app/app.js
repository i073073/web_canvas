const canvasWrap = document.getElementById("canvasWrap");
const chatLog = document.getElementById("chatLog");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const statusText = document.getElementById("statusText");
const jsonImportInput = document.getElementById("jsonImportInput");
const detailPanel = document.getElementById("detailPanel");
const detailType = document.getElementById("detailType");
const closeDetail = document.getElementById("closeDetail");
const nodeText = document.getElementById("nodeText");
const nodeFill = document.getElementById("nodeFill");
const nodeTextColor = document.getElementById("nodeTextColor");
const nodeFontFamily = document.getElementById("nodeFontFamily");
const nodeFontSize = document.getElementById("nodeFontSize");
const nodeStyleControls = document.getElementById("nodeStyleControls");
const nodeNote = document.getElementById("nodeNote");
const nodeLink = document.getElementById("nodeLink");
const nodePayload = document.getElementById("nodePayload");
const noteLabel = document.getElementById("noteLabel");
const linkLabel = document.getElementById("linkLabel");
const payloadLabel = document.getElementById("payloadLabel");
const childContent = document.getElementById("childContent");
const referenceDrop = document.getElementById("referenceDrop");
const fileInput = document.getElementById("fileInput");

if (!window.Konva) {
  document.body.innerHTML = "<p style='padding:16px;font-family:Arial'>Konva.js를 불러오지 못했습니다. 인터넷 연결을 확인하거나 Konva 파일을 로컬로 vendoring 해주세요.</p>";
  throw new Error("Konva.js is required.");
}

const WORLD = { width: 12000, height: 9000 };
const NODE = { width: 170, minHeight: 62 };
const GROUP_PAD = 26;

const stage = new Konva.Stage({
  container: "canvasWrap",
  width: canvasWrap.clientWidth,
  height: canvasWrap.clientHeight,
  draggable: false
});

let selectionStart = null;
let selectionRect = null;

const backgroundLayer = new Konva.Layer();
const groupLayer = new Konva.Layer();
const edgeLayer = new Konva.Layer();
const nodeLayer = new Konva.Layer();
const guideLayer = new Konva.Layer();
const transformer = new Konva.Transformer({
  rotateEnabled: false,
  enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right", "top-center", "bottom-center", "middle-left", "middle-right"],
  boundBoxFunc: (oldBox, newBox) => ({
    ...newBox,
    width: Math.max(80, newBox.width),
    height: Math.max(46, newBox.height)
  })
});
stage.add(backgroundLayer, groupLayer, edgeLayer, nodeLayer, guideLayer);

transformer.on("transformend", () => {
  if (isNodeDragging) return;
  const rect = transformer.nodes()[0];
  const nodeId = selectedIds.length === 1 ? selectedIds[0] : null;
  if (!rect || !nodeId || !getNode(nodeId)) return;

  const width = Math.max(80, rect.width() * rect.scaleX());
  const height = Math.max(46, rect.height() * rect.scaleY());
  rect.scale({ x: 1, y: 1 });
  setState((draft) => {
    draft.nodes = draft.nodes.map((item) => (
      item.id === nodeId
        ? { ...item, x: rect.x(), y: rect.y(), width, height }
        : item
    ));
    return syncGroups(draft);
  });
  announceAction(`command: resizeNode("${nodeId}", ${Math.round(width)}, ${Math.round(height)})`);
});

selectionRect = new Konva.Rect({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  fill: "rgba(15, 140, 170, 0.12)",
  stroke: "#0f8b8d",
  dash: [6, 4],
  strokeWidth: 1,
  visible: false,
  listening: false
});
guideLayer.add(selectionRect);

let state = { nodes: [], edges: [], groups: [] };
let selectedIds = [];
let selectedGroupId = null;
let pendingConnector = null;
let suppressInspector = false;
let historyStack = [];
let redoStack = [];
let idCounter = 1;
let isRendering = false;
let isNodeDragging = false;
let internalClipboard = null;

const nodeShapes = new Map();
const groupShapes = new Map();
const edgeShapes = new Map();

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme() {
  return {
    ink: cssVar("--ink"),
    muted: cssVar("--muted"),
    line: cssVar("--line"),
    accent: cssVar("--accent"),
    accentStrong: cssVar("--accent-strong"),
    edge: cssVar("--edge"),
    node: cssVar("--node"),
    nodeSelected: cssVar("--node-selected"),
    mark: cssVar("--mark")
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function measureWrappedTextHeight(text, width, fontSize, fontFamily) {
  const canvas = measureWrappedTextHeight.canvas || document.createElement("canvas");
  measureWrappedTextHeight.canvas = canvas;
  const ctx = canvas.getContext("2d");
  const safeWidth = Math.max(20, width);
  const size = Number(fontSize) || 15;
  ctx.font = `${size}px ${fontFamily || "Arial, Helvetica, sans-serif"}`;
  const paragraphs = String(text || "새 노드").split(/\r?\n/);
  let lines = 0;

  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      lines += 1;
      return;
    }
    let current = "";
    Array.from(paragraph).forEach((char) => {
      const next = current + char;
      if (ctx.measureText(next).width > safeWidth && current) {
        lines += 1;
        current = char;
      } else {
        current = next;
      }
    });
    lines += current ? 1 : 0;
  });

  return Math.ceil(Math.max(1, lines) * size * 1.25);
}

function requiredNodeHeight(node) {
  const textHeight = measureWrappedTextHeight(
    node.text,
    (Number(node.width) || NODE.width) - 24,
    node.fontSize,
    node.fontFamily
  );
  const metaSpace = node.note || node.link || node.payload ? 28 : 16;
  return Math.max(NODE.minHeight, textHeight + metaSpace + 20);
}

function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function downloadJsonFile() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `web-canvas-${timestampForFilename()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  announceAction(`명령: exportState("${link.download}")`);
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    setState(parsed);
    selectedIds = [];
    selectedGroupId = null;
    render();
    centerCanvasOnContent();
    announceAction(`명령: importState("${file.name}")`);
  } catch (error) {
    announceAction(`JSON Import 실패: ${error.message}`);
  }
}

function nextId(prefix) {
  const id = `${prefix}_${idCounter}`;
  idCounter += 1;
  return id;
}

function reconcileIdCounter() {
  const ids = [
    ...state.nodes.map((node) => node.id),
    ...state.edges.map((edge) => edge.id),
    ...state.groups.map((group) => group.id)
  ];
  const max = ids.reduce((acc, id) => {
    const match = String(id).match(/_(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  idCounter = Math.max(idCounter, max + 1);
}

function normalizeState(input) {
  const t = theme();
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const groups = Array.isArray(input.groups) ? input.groups : [];
  const usedNodeIds = new Set();
  const usedGroupIds = new Set();
  const usedEdgeIds = new Set();
  const nodeIdAlias = new Map();
  const groupIdAlias = new Map();

  const normalizedGroups = groups.map((group) => {
    const rawId = String(group.id || nextId("group"));
    let id = rawId;
    if (usedGroupIds.has(id)) id = nextId("group");
    usedGroupIds.add(id);
    if (!groupIdAlias.has(rawId)) groupIdAlias.set(rawId, id);
    return {
      id,
      title: group.title || "Group",
      note: group.note || "",
      x: Number(group.x) || 0,
      y: Number(group.y) || 0,
      width: Math.max(180, Number(group.width) || 280),
      height: Math.max(120, Number(group.height) || 180),
      parentGroupId: group.parentGroupId ? String(group.parentGroupId) : null
    };
  }).map((group) => {
    const mappedParent = group.parentGroupId ? groupIdAlias.get(group.parentGroupId) || null : null;
    return { ...group, parentGroupId: mappedParent && mappedParent !== group.id ? mappedParent : null };
  });

  const normalizedNodes = nodes.map((node) => {
    const rawId = String(node.id || nextId("node"));
    let id = rawId;
    if (usedNodeIds.has(id)) id = nextId("node");
    usedNodeIds.add(id);
    if (!nodeIdAlias.has(rawId)) nodeIdAlias.set(rawId, id);
    const normalized = {
      id,
      text: node.text || "Node",
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      width: Math.max(80, Number(node.width) || NODE.width),
      height: Math.max(46, Number(node.height) || NODE.minHeight),
      groupId: node.groupId ? String(node.groupId) : null,
      note: node.note || "",
      link: node.link || "",
      payload: node.payload || "",
      children: Array.isArray(node.children) ? node.children : [],
      fill: node.fill || t.node,
      textColor: node.textColor || t.ink,
      fontFamily: node.fontFamily || "Arial, Helvetica, sans-serif",
      fontSize: Number(node.fontSize) || 15
    };
    normalized.height = Math.max(normalized.height, requiredNodeHeight(normalized));
    return normalized;
  }).map((node) => ({
    ...node,
    groupId: node.groupId ? groupIdAlias.get(node.groupId) || null : null
  }));

  const normalizedEdges = edges
    .map((edge) => ({
      id: String(edge.id || nextId("edge")),
      from: edge.from ? String(edge.from) : "",
      to: edge.to ? String(edge.to) : "",
      label: edge.label || ""
    }))
    .map((edge) => ({
      ...edge,
      from: nodeIdAlias.get(edge.from) || edge.from,
      to: nodeIdAlias.get(edge.to) || edge.to
    }))
    .filter((edge) => edge.from && edge.to && edge.from !== edge.to && usedNodeIds.has(edge.from) && usedNodeIds.has(edge.to))
    .map((edge) => {
      let id = edge.id;
      if (usedEdgeIds.has(id)) id = nextId("edge");
      usedEdgeIds.add(id);
      return { ...edge, id };
    });

  return {
    nodes: normalizedNodes,
    edges: normalizedEdges,
    groups: normalizedGroups
  };
}

function setState(updater, options = {}) {
  const previous = clone(state);
  const next = typeof updater === "function" ? updater(clone(state)) : updater;
  if (!options.skipHistory) {
    historyStack.push(previous);
    redoStack = [];
  }
  state = normalizeState(next);
  reconcileIdCounter();
  render();
  if (!options.skipSave) {
    saveStateToStorage();
  }
}

function worldPointer() {
  const pointer = stage.getPointerPosition();
  if (!pointer) return { x: 0, y: 0 };
  const scale = stage.scaleX();
  return {
    x: (pointer.x - stage.x()) / scale,
    y: (pointer.y - stage.y()) / scale
  };
}

function addMessage(text, type = "system") {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

const STORAGE_KEY = "webCanvasState.v1";
const STORAGE_BACKUP_KEY = "webCanvasState.v1.backup";

function announceAction(text) {
  statusText.textContent = text;
  addMessage(text, "action");
}

function saveStateToStorage() {
  try {
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous && previous !== JSON.stringify(state)) {
      localStorage.setItem(STORAGE_BACKUP_KEY, previous);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    statusText.textContent = "저장됨";
  } catch (error) {
    console.warn("localStorage save failed", error);
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("localStorage clear failed", error);
  }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.groups) && Array.isArray(parsed.edges)) {
      if (!parsed.nodes.length && !parsed.groups.length && !parsed.edges.length) {
        return false;
      }
    }
    setState(parsed, { skipHistory: true, skipSave: true });
    centerCanvasOnContent();
    announceAction("저장된 캔버스 상태 복원됨.");
    return true;
  } catch (error) {
    console.warn("localStorage load failed", error);
    return false;
  }
}

function getNode(id) {
  return state.nodes.find((node) => node.id === id);
}

function getGroup(id) {
  return state.groups.find((group) => group.id === id);
}

function nodeCenter(node) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function boundaryPoint(node, toward) {
  const center = nodeCenter(node);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const scale = Math.min(Math.abs(hw / (dx || 1)), Math.abs(hh / (dy || 1)));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function edgePoints(edge, overrideNode = null) {
  const from = overrideNode?.id === edge.from ? overrideNode : getNode(edge.from);
  const to = overrideNode?.id === edge.to ? overrideNode : getNode(edge.to);
  if (!from || !to) return [0, 0, 0, 0];
  const start = boundaryPoint(from, nodeCenter(to));
  const end = boundaryPoint(to, nodeCenter(from));
  return [start.x, start.y, end.x, end.y];
}

function boundsForItems(items, pad = 0) {
  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(180, maxX - minX + pad * 2),
    height: Math.max(120, maxY - minY + pad * 2)
  };
}

function contentBounds() {
  const items = [...state.groups, ...state.nodes];
  if (!items.length) return null;
  return boundsForItems(items, 48);
}

function centerCanvasOnContent() {
  const bounds = contentBounds();
  if (!bounds) return;
  const availableWidth = Math.max(240, canvasWrap.clientWidth);
  const availableHeight = Math.max(180, canvasWrap.clientHeight);
  const scale = Math.min(1, availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height));
  stage.scale({ x: scale, y: scale });
  stage.position({
    x: (availableWidth - bounds.width * scale) / 2 - bounds.x * scale,
    y: (availableHeight - bounds.height * scale) / 2 - bounds.y * scale
  });
  stage.batchDraw();
  statusText.textContent = `Zoom ${Math.round(scale * 100)}%`;
}

function rectangleIntersects(item, rect) {
  return (
    item.x < rect.x + rect.width &&
    item.x + item.width > rect.x &&
    item.y < rect.y + rect.height &&
    item.y + item.height > rect.y
  );
}

function syncGroups(draft) {
  draft.nodes = draft.nodes.map((node) => {
    const center = nodeCenter(node);
    const containing = draft.groups.find((group) => (
      center.x >= group.x &&
      center.y >= group.y &&
      center.x <= group.x + group.width &&
      center.y <= group.y + group.height
    ));
    return { ...node, groupId: containing ? containing.id : null };
  });

  draft.groups = draft.groups.map((group) => {
    const center = { x: group.x + group.width / 2, y: group.y + group.height / 2 };
    const parent = draft.groups.find((other) => (
      other.id !== group.id &&
      center.x >= other.x &&
      center.y >= other.y &&
      center.x <= other.x + other.width &&
      center.y <= other.y + other.height
    ));
    const members = draft.nodes.filter((node) => node.groupId === group.id);
    const nestedGroups = draft.groups.filter((child) => child.parentGroupId === group.id);
    let nextGroup = { ...group, parentGroupId: parent ? parent.id : null };
    if (members.length || nestedGroups.length) {
      nextGroup = { ...nextGroup, ...boundsForItems([...members, ...nestedGroups], GROUP_PAD) };
    }
    return nextGroup;
  });

  return draft;
}

function focusTitleSoon() {
  window.setTimeout(() => {
    nodeText.focus();
    nodeText.select();
  }, 0);
}

function createNode(text, x, y, extra = {}) {
  const point = typeof x === "number" ? { x, y } : worldPointer();
  const id = nextId("node");
  setState((draft) => {
    draft.nodes.push({
      id,
      text: text || "새 아이디어",
      x: point.x,
      y: point.y,
      width: NODE.width,
      height: NODE.minHeight,
      groupId: null,
      note: "",
      link: "",
      payload: "",
      children: [],
      fill: theme().node,
      textColor: theme().ink,
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: 15,
      ...extra
    });
    return draft;
  });
  selectedIds = [id];
  selectedGroupId = null;
  render();
  announceAction(`명령: createNode("${text || "새 아이디어"}")`);
  return id;
}

function getValidSelection(id = null) {
  if (id) {
    return { nodeIds: getNode(id) ? [id] : [], groupId: null };
  }

  const existingNodeIds = new Set(state.nodes.map((node) => node.id));
  const nodeIds = [...new Set(selectedIds)].filter((nodeId) => existingNodeIds.has(nodeId));
  const groupId = nodeIds.length ? null : (selectedGroupId && getGroup(selectedGroupId) ? selectedGroupId : null);
  selectedIds = nodeIds;
  selectedGroupId = groupId;
  return { nodeIds, groupId };
}

function duplicateNodeIdSummary() {
  const counts = new Map();
  state.nodes.forEach((node) => {
    const key = String(node.id);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const duplicates = [...counts.entries()].filter((entry) => entry[1] > 1);
  if (!duplicates.length) return "none";
  return duplicates.map((entry) => `${entry[0]}x${entry[1]}`).join(",");
}

function deleteSelection(id = null, options = {}) {
  const focusedNode = transformer.nodes()[0];
  const focusedId = focusedNode && typeof focusedNode.id === "function" ? focusedNode.id() : "none";
  announceAction(`debug: del_req(id=${id || "none"}, allowBulk=${options.allowBulk ? "y" : "n"}, focused=${focusedId}, selected=[${selectedIds.join(",")}], dupNodeIds=${duplicateNodeIdSummary()})`);
  const { nodeIds, groupId } = getValidSelection(id);
  announceAction(`debug: del_target(nodes=[${nodeIds.join(",")}], group=${groupId || "none"})`);
  if (!nodeIds.length && !groupId) {
    return announceAction("삭제할 노드나 그룹을 선택하세요.");
  }

  if (!id && nodeIds.length > 1 && !options.allowBulk) {
    const lastSelectedId = selectedIds[selectedIds.length - 1];
    if (lastSelectedId && nodeIds.includes(lastSelectedId)) {
      announceAction(`명령: singleDeleteFallback("${lastSelectedId}") from multi(${nodeIds.length})`);
      return deleteSelection(lastSelectedId, { allowBulk: false });
    }
    return announceAction(`여러 노드 ${nodeIds.length}개가 선택되어 있습니다. 한 번에 삭제하려면 Shift+Delete를 누르세요.`);
  }

  setState((draft) => {
    if (nodeIds.length) {
      draft.edges = draft.edges.filter((edge) => !nodeIds.includes(edge.from) && !nodeIds.includes(edge.to));
      draft.nodes = draft.nodes.filter((node) => !nodeIds.includes(node.id));
    }

    if (groupId) {
      const removedGroupIds = new Set();
      const collectGroupIds = (idToRemove) => {
        removedGroupIds.add(idToRemove);
        draft.groups.forEach((group) => {
          if (group.parentGroupId === idToRemove) collectGroupIds(group.id);
        });
      };
      collectGroupIds(groupId);

      draft.groups = draft.groups.filter((group) => !removedGroupIds.has(group.id));
      draft.nodes = draft.nodes.map((node) => (
        removedGroupIds.has(node.groupId) ? { ...node, groupId: null } : node
      ));
    }

    return syncGroups(draft);
  });

  if (!id) {
    selectedIds = [];
    selectedGroupId = null;
  }
  render();
  announceAction(`명령: deleteSelection(nodes=${nodeIds.length}, group=${groupId ? groupId : "none"})`);
}

function connectNodes(from, to) {
  if (!from || !to || from === to) return;
  const exists = state.edges.some((edge) => edge.from === from && edge.to === to);
  if (exists) return announceAction("이미 연결되어 있습니다.");
  setState((draft) => {
    draft.edges.push({ id: nextId("edge"), from, to, label: "" });
    return draft;
  });
  announceAction(`명령: connectNodes("${from}", "${to}")`);
}

function createGroupFromSelection() {
  const selectedNodes = state.nodes.filter((node) => selectedIds.includes(node.id));
  const selectedGroup = selectedGroupId ? getGroup(selectedGroupId) : null;
  if (!selectedNodes.length && !selectedGroup) {
    announceAction("그룹으로 묶을 노드나 그룹을 선택하세요.");
    return;
  }
  const items = [...selectedNodes];
  if (selectedGroup) items.push(selectedGroup);
  const box = boundsForItems(items, GROUP_PAD);
  const groupId = nextId("group");
  setState((draft) => {
    draft.groups.push({ id: groupId, title: "그룹", note: "", parentGroupId: null, ...box });
    draft.nodes = draft.nodes.map((node) => (
      selectedIds.includes(node.id) ? { ...node, groupId } : node
    ));
    draft.groups = draft.groups.map((group) => (
      selectedGroup && group.id === selectedGroup.id ? { ...group, parentGroupId: groupId } : group
    ));
    return draft;
  });
  selectedGroupId = groupId;
  selectedIds = [];
  render();
  announceAction(`명령: createGroup()`);
}

function collectSelectionForClipboard() {
  if (selectedGroupId) {
    const group = getGroup(selectedGroupId);
    if (!group) return null;
    const nodes = state.nodes.filter((node) => node.groupId === group.id);
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      type: "web-canvas-selection",
      nodes: clone(nodes),
      edges: clone(state.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))),
      groups: [clone(group)]
    };
  }

  if (selectedIds.length) {
    const nodeIds = new Set(selectedIds);
    return {
      type: "web-canvas-selection",
      nodes: clone(state.nodes.filter((node) => nodeIds.has(node.id))),
      edges: clone(state.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))),
      groups: []
    };
  }

  return null;
}

async function copySelection() {
  const payload = collectSelectionForClipboard();
  if (!payload || !payload.nodes.length) {
    announceAction("복사할 노드나 그룹을 선택하세요.");
    return;
  }
  internalClipboard = payload;
  await navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => {});
  announceAction(`명령: copySelection(${payload.nodes.length} nodes)`);
}

async function pasteSelection() {
  let payload = internalClipboard;
  if (!payload && navigator.clipboard?.readText) {
    try {
      const parsed = JSON.parse(await navigator.clipboard.readText());
      if (parsed?.type === "web-canvas-selection") payload = parsed;
    } catch {
      payload = null;
    }
  }
  if (!payload || !Array.isArray(payload.nodes) || !payload.nodes.length) {
    announceAction("붙여넣을 캔버스 항목이 없습니다.");
    return;
  }

  const minX = Math.min(...payload.nodes.map((node) => node.x));
  const minY = Math.min(...payload.nodes.map((node) => node.y));
  const pointer = stage.getPointerPosition() ? worldPointer() : null;
  const dx = pointer ? pointer.x - minX : 42;
  const dy = pointer ? pointer.y - minY : 42;
  const nodeIdMap = new Map();
  const groupIdMap = new Map();

  const groups = (payload.groups || []).map((group) => {
    const id = nextId("group");
    groupIdMap.set(group.id, id);
    return { ...clone(group), id, x: group.x + dx, y: group.y + dy };
  });

  const nodes = payload.nodes.map((node) => {
    const id = nextId("node");
    nodeIdMap.set(node.id, id);
    return {
      ...clone(node),
      id,
      x: node.x + dx,
      y: node.y + dy,
      groupId: groupIdMap.get(node.groupId) || null
    };
  });

  const edges = (payload.edges || [])
    .filter((edge) => nodeIdMap.has(edge.from) && nodeIdMap.has(edge.to))
    .map((edge) => ({
      ...clone(edge),
      id: nextId("edge"),
      from: nodeIdMap.get(edge.from),
      to: nodeIdMap.get(edge.to)
    }));

  setState((draft) => {
    draft.groups.push(...groups);
    draft.nodes.push(...nodes);
    draft.edges.push(...edges);
    return syncGroups(draft);
  });
  selectedGroupId = groups.length === 1 ? groups[0].id : null;
  selectedIds = selectedGroupId ? [] : nodes.map((node) => node.id);
  render();
  announceAction(`명령: pasteSelection(${nodes.length} nodes)`);
}

function render() {
  if (isRendering) return;
  isRendering = true;
  const t = theme();
  transformer.nodes([]);
  if (transformer.getLayer()) transformer.remove();
  groupLayer.destroyChildren();
  edgeLayer.destroyChildren();
  nodeLayer.destroyChildren();
  nodeShapes.clear();
  groupShapes.clear();
  edgeShapes.clear();

  state.groups.forEach((group) => drawGroup(group, t));
  state.edges.forEach((edge) => drawEdge(edge, t));
  state.nodes.forEach((node) => drawNode(node, t));
  nodeLayer.add(transformer);
  drawWorldFrame(t);

  groupLayer.draw();
  edgeLayer.draw();
  nodeLayer.draw();
  guideLayer.draw();
  updateInspector();
  isRendering = false;
}

function drawWorldFrame(t) {
  const existing = guideLayer.findOne("#worldFrame");
  if (existing) existing.destroy();
  guideLayer.add(new Konva.Rect({
    id: "worldFrame",
    x: 0,
    y: 0,
    width: WORLD.width,
    height: WORLD.height,
    stroke: t.line,
    dash: [12, 8],
    listening: false
  }));
}

function drawGroup(group, t) {
  const shape = new Konva.Group({ x: group.x, y: group.y, draggable: true, id: group.id });
  const title = new Konva.Text({
    x: 12,
    y: 10,
    text: group.title,
    fill: t.accentStrong,
    fontStyle: "bold",
    fontSize: 14
  });
  shape.add(new Konva.Rect({
    width: group.width,
    height: group.height,
    fill: `${t.accent}20`,
    stroke: selectedGroupId === group.id ? t.accentStrong : t.accent,
    strokeWidth: selectedGroupId === group.id ? 3 : 2,
    cornerRadius: 8,
    dash: [8, 5]
  }));
  shape.add(title);
  shape.on("click tap", (event) => {
    event.cancelBubble = true;
    suppressInspector = false;
    selectedGroupId = group.id;
    selectedIds = [];
    render();
    announceAction(`선택: group("${group.id}")`);
  });
  shape.on("dblclick dbltap", (event) => {
    event.cancelBubble = true;
    suppressInspector = false;
    selectedGroupId = group.id;
    selectedIds = [];
    render();
    focusTitleSoon();
  });
  shape.on("dragmove", () => {
    const dx = shape.x() - group.x;
    const dy = shape.y() - group.y;
    state.nodes.filter((node) => node.groupId === group.id).forEach((node) => {
      const nodeShape = nodeShapes.get(node.id);
      if (nodeShape) nodeShape.position({ x: node.x + dx, y: node.y + dy });
    });
    state.groups.filter((child) => child.parentGroupId === group.id).forEach((child) => {
      const childShape = groupShapes.get(child.id);
      if (childShape) childShape.position({ x: child.x + dx, y: child.y + dy });
    });
    updateGroupEdgePreview(group.id, dx, dy);
  });
  shape.on("dragend", () => {
    const dx = shape.x() - group.x;
    const dy = shape.y() - group.y;
    setState((draft) => {
      draft.groups = draft.groups.map((item) => (
        item.id === group.id ? { ...item, x: item.x + dx, y: item.y + dy } : item
      ));
      draft.nodes = draft.nodes.map((node) => (
        node.groupId === group.id ? { ...node, x: node.x + dx, y: node.y + dy } : node
      ));
      draft.groups = draft.groups.map((item) => (
        item.parentGroupId === group.id ? { ...item, x: item.x + dx, y: item.y + dy } : item
      ));
      return syncGroups(draft);
    });
    announceAction(`명령: moveGroup("${group.id}", ${Math.round(dx)}, ${Math.round(dy)})`);
  });
  groupShapes.set(group.id, shape);
  groupLayer.add(shape);
}

function updateGroupEdgePreview(groupId, dx, dy) {
  state.edges.forEach((edge) => {
    const from = getNode(edge.from);
    const to = getNode(edge.to);
    const points = edgePoints(edge);
    const adjusted = [
      points[0] + (from?.groupId === groupId ? dx : 0),
      points[1] + (from?.groupId === groupId ? dy : 0),
      points[2] + (to?.groupId === groupId ? dx : 0),
      points[3] + (to?.groupId === groupId ? dy : 0)
    ];
    const arrow = edgeShapes.get(edge.id);
    if (arrow) arrow.points(adjusted);
  });
  edgeLayer.batchDraw();
  nodeLayer.batchDraw();
}

function drawEdge(edge, t) {
  const arrow = new Konva.Arrow({
    points: edgePoints(edge),
    pointerLength: 12,
    pointerWidth: 12,
    fill: t.edge,
    stroke: t.edge,
    strokeWidth: 2,
    lineCap: "round",
    lineJoin: "round"
  });
  edgeShapes.set(edge.id, arrow);
  edgeLayer.add(arrow);
}

function drawNode(node, t) {
  const group = new Konva.Group({ x: node.x, y: node.y, draggable: true, id: node.id });
  const isSelected = selectedIds.includes(node.id);
  group.add(new Konva.Rect({
    width: node.width,
    height: node.height,
    fill: node.fill,
    stroke: isSelected ? t.mark : t.line,
    strokeWidth: isSelected ? 3 : 1.5,
    cornerRadius: 8,
    shadowColor: "#000000",
    shadowBlur: 10,
    shadowOpacity: 0.16,
    shadowOffset: { x: 0, y: 2 }
  }));
  group.add(new Konva.Text({
    x: 12,
    y: 10,
    width: node.width - 24,
    height: Math.max(24, node.height - 28),
    text: node.text,
    fill: node.textColor,
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    lineHeight: 1.25,
    wrap: "char",
    ellipsis: false,
    listening: false
  }));
  group.add(new Konva.Text({
    x: 12,
    y: node.height - 20,
    width: node.width - 42,
    text: node.note || node.link || node.payload ? "메모 있음" : "",
    fill: t.muted,
    fontSize: 11,
    listening: false
  }));
  const connector = new Konva.Circle({
    x: node.width,
    y: node.height / 2,
    radius: 8,
    fill: t.accent,
    stroke: node.fill,
    strokeWidth: 2,
    name: "connector"
  });
  group.add(connector);
  nodeShapes.set(node.id, group);
  nodeLayer.add(group);

  group.on("click tap", (event) => {
    event.cancelBubble = true;
    suppressInspector = false;
    if (event.evt.ctrlKey || event.evt.metaKey) {
      if (selectedIds.includes(node.id)) {
        selectedIds = selectedIds.filter((selected) => selected !== node.id);
      } else {
        selectedIds = [...selectedIds, node.id];
      }
    } else {
      selectedIds = [node.id];
    }
    selectedGroupId = null;
    render();
    announceAction(`선택: node("${node.id}")`);
  });

  group.on("dragstart", () => {
    isNodeDragging = true;
    suppressInspector = false;
    selectedIds = [node.id];
    selectedGroupId = null;
    transformer.nodes([group]);
    updateInspector();
    nodeLayer.batchDraw();
  });

  group.on("dragend", () => {
    isNodeDragging = false;
    setState((draft) => {
      draft.nodes = draft.nodes.map((item) => (
        item.id === node.id ? { ...item, x: group.x(), y: group.y() } : item
      ));
      return syncGroups(draft);
    });
    announceAction(`명령: moveNode("${node.id}", ${Math.round(group.x())}, ${Math.round(group.y())})`);
  });

  if (selectedIds.length === 1 && isSelected) {
    transformer.nodes([group]);
  }
}

let panStart = null;
let stageStartPos = null;

stage.on("mousedown touchstart", (event) => {
  const button = event.evt?.button;
  if (button === 1) {
    panStart = { x: event.evt.clientX, y: event.evt.clientY };
    stageStartPos = stage.position();
    return;
  }
  if (event.target !== stage) return;
  suppressInspector = true;
  selectionStart = worldPointer();
  selectionRect.visible(true);
  selectionRect.position(selectionStart);
  selectionRect.size({ width: 0, height: 0 });
  guideLayer.batchDraw();
});

stage.on("mousemove touchmove", (event) => {
  if (panStart) {
    const dx = event.evt.clientX - panStart.x;
    const dy = event.evt.clientY - panStart.y;
    stage.position({ x: stageStartPos.x + dx, y: stageStartPos.y + dy });
    stage.batchDraw();
    return;
  }
  if (!selectionStart) return;
  const pointer = worldPointer();
  const x = Math.min(pointer.x, selectionStart.x);
  const y = Math.min(pointer.y, selectionStart.y);
  const width = Math.abs(pointer.x - selectionStart.x);
  const height = Math.abs(pointer.y - selectionStart.y);
  selectionRect.visible(true);
  selectionRect.position({ x, y });
  selectionRect.size({ width, height });
  guideLayer.batchDraw();
});

stage.on("mouseup touchend", (event) => {
  if (panStart) {
    panStart = null;
    stageStartPos = null;
  }
  if (selectionStart) {
    const rect = {
      x: selectionRect.x(),
      y: selectionRect.y(),
      width: selectionRect.width(),
      height: selectionRect.height()
    };
    selectionRect.visible(false);
    selectionStart = null;
    guideLayer.batchDraw();

    if (rect.width < 6 && rect.height < 6) {
      selectedIds = [];
      selectedGroupId = null;
      render();
      return;
    }

    const groups = state.groups.filter((group) => rectangleIntersects(group, rect));
    const nodes = state.nodes.filter((node) => rectangleIntersects(node, rect));
    if (groups.length === 1 && nodes.length === 0) {
      selectedGroupId = groups[0].id;
      selectedIds = [];
    } else {
      selectedIds = nodes.map((node) => node.id);
      selectedGroupId = null;
    }
    render();
  }
  if (!pendingConnector) return;
  const targetGroup = event.target.findAncestor("Group");
  const targetId = targetGroup && targetGroup.id();
  if (targetId && targetId !== pendingConnector && getNode(targetId)) {
    connectNodes(pendingConnector, targetId);
  }
  pendingConnector = null;
});

stage.on("dblclick dbltap", (event) => {
  if (event.target !== stage) return;
  createNode("새 아이디어");
});

stage.on("click tap", (event) => {
  if (event.target === stage) {
    selectedIds = [];
    selectedGroupId = null;
    suppressInspector = false;
    detailPanel.hidden = true;
    render();
  }
});

stage.on("wheel", (event) => {
  event.evt.preventDefault();
  const oldScale = stage.scaleX();
  const pointer = stage.getPointerPosition();
  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale
  };
  const newScale = event.evt.deltaY > 0 ? oldScale / 1.07 : oldScale * 1.07;
  applyZoom(Math.max(0.2, Math.min(3, newScale)), mousePointTo, pointer);
});

function applyZoom(scale, focus, pointer) {
  if (focus && pointer) {
    stage.position({
      x: pointer.x - focus.x * scale,
      y: pointer.y - focus.y * scale
    });
  }
  stage.scale({ x: scale, y: scale });
  stage.batchDraw();
  statusText.textContent = `Zoom ${Math.round(scale * 100)}%`;
}

document.getElementById("zoomOut").addEventListener("click", () => {
  applyZoom(Math.max(0.2, stage.scaleX() / 1.2));
});
document.getElementById("zoomReset").addEventListener("click", () => {
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  stage.batchDraw();
  statusText.textContent = "Zoom 100%";
});
document.getElementById("zoomIn").addEventListener("click", () => {
  applyZoom(Math.min(3, stage.scaleX() * 1.2));
});
document.getElementById("createGroup").addEventListener("click", createGroupFromSelection);

document.getElementById("exportBtn").addEventListener("click", downloadJsonFile);

document.getElementById("importBtn").addEventListener("click", () => {
  jsonImportInput.click();
});

const resetSavedBtn = document.getElementById("resetSavedBtn");
if (resetSavedBtn) {
  resetSavedBtn.addEventListener("click", resetSavedCanvas);
}

jsonImportInput.addEventListener("change", async () => {
  await importJsonFile(jsonImportInput.files?.[0]);
  jsonImportInput.value = "";
});

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) return;
  addMessage(command, "user");
  commandInput.value = "";
  await handleCommand(command);
});

document.getElementById("aiCommandBtn").addEventListener("click", async () => {
  const command = commandInput.value.trim();
  if (!command) return;
  addMessage(command, "user");
  commandInput.value = "";
  await handleCommand(command);
});

async function interpretCommandWithAgent(command) {
  if (window.webCanvasAgentInterpreter) {
    try {
      return await window.webCanvasAgentInterpreter(command, {
        state: clone(state),
        selectedIds,
        selectedGroupId
      });
    } catch (error) {
      console.warn("Agent interpreter failed", error);
    }
  }
  return command;
}

async function handleCommand(command) {
  const interpreted = await interpretCommandWithAgent(command);
  if (interpreted && interpreted !== command) {
    addMessage(`LLM 해석: ${interpreted}`, "system");
    return runCommand(interpreted);
  }
  return runCommand(command);
}

document.addEventListener("keydown", async (event) => {
  const key = event.key.toLowerCase();
  if (!isEditableTarget(event.target) && key === "delete") {
    event.preventDefault();
    if (event.shiftKey) {
      deleteSelection(null, { allowBulk: true });
    } else {
      const focusedNode = transformer.nodes()[0];
      if (focusedNode && typeof focusedNode.id === "function" && focusedNode.id()) {
        deleteSelection(focusedNode.id(), { allowBulk: false });
      } else {
        deleteSelection(null, { allowBulk: false });
      }
    }
    return;
  }

  const mod = event.ctrlKey || event.metaKey;
  if (!mod || isEditableTarget(event.target)) return;

  if (key === "c") {
    event.preventDefault();
    await copySelection();
    return;
  }
  if (key === "v") {
    event.preventDefault();
    await pasteSelection();
    return;
  }
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undo();
    return;
  }
  if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    redo();
  }
});

function runCommand(command) {
  const normalized = command.trim();
  if (!normalized) return;
  if (/^(reset|clear saved|clear storage)$/i.test(normalized) || normalized === "초기화") return resetSavedCanvas();
  if (/^(취소|undo)$/i.test(normalized)) return undo();
  if (/^(다시|redo)$/i.test(normalized)) return redo();
  if (/^(내보내기|export)$/i.test(normalized)) return downloadJsonFile();
  if (/^(가져오기|import)$/i.test(normalized)) return jsonImportInput.click();
  if (/^(삭제 전체|bulk delete)$/i.test(normalized)) return deleteSelection(null, { allowBulk: true });
  if (/^(삭제|delete)$/i.test(normalized)) {
    const focusedNode = transformer.nodes()[0];
    if (focusedNode && typeof focusedNode.id === "function" && focusedNode.id()) {
      return deleteSelection(focusedNode.id(), { allowBulk: false });
    }
    return deleteSelection(null, { allowBulk: false });
  }
  if (/^(그룹|group)/i.test(normalized)) return createGroupFromSelection();
  if (/^(복사|copy)$/i.test(normalized)) return copySelection();
  if (/^(붙여넣기|paste)$/i.test(normalized)) return pasteSelection();
  if (/^(연결|connect)\b/i.test(normalized)) return connectFromCommand(normalized);
  if (/^(제목|title)\s+(.+)/i.test(normalized)) {
    const value = normalized.replace(/^(제목|title)\s+/i, "");
    if (selectedGroupId) return setSelectedGroupTitle(value);
    return setSelectedNodeField("text", value);
  }
  if (/^(노트|note)\s+(.+)/i.test(normalized)) {
    const value = normalized.replace(/^(노트|note)\s+/i, "");
    if (selectedGroupId) return setSelectedGroupField("note", value);
    return setSelectedNodeField("note", value);
  }
  if (/^(색상|색|fill)\s+(.+)/i.test(normalized)) return selectedGroupId ? setSelectedGroupField("fill", normalized.replace(/^(색상|색|fill)\s+/i, "")) : setSelectedNodeField("fill", normalized.replace(/^(색상|색|fill)\s+/i, ""));
  if (/^(글자색|텍스트색|textcolor)\s+(.+)/i.test(normalized)) return selectedGroupId ? setSelectedGroupField("textColor", normalized.replace(/^(글자색|텍스트색|textcolor)\s+/i, "")) : setSelectedNodeField("textColor", normalized.replace(/^(글자색|텍스트색|textcolor)\s+/i, ""));
  if (/^(폰트|글꼴|font)\s+(.+)/i.test(normalized)) return selectedGroupId ? setSelectedGroupField("fontFamily", normalized.replace(/^(폰트|글꼴|font)\s+/i, "")) : setSelectedNodeField("fontFamily", normalized.replace(/^(폰트|글꼴|font)\s+/i, ""));
  if (/^(크기|fontsize|font size)\s+(\d+)/i.test(normalized)) return selectedGroupId ? setSelectedGroupField("fontSize", Number(normalized.replace(/^(크기|fontsize|font size)\s+/i, ""))) : setSelectedNodeField("fontSize", Number(normalized.replace(/^(크기|fontsize|font size)\s+/i, "")));
  const addMatch = normalized.match(/^(추가|add|create)\s+(.+)/i);
  if (addMatch) return createNode(addMatch[2]);
  if (/^메모\s+(.+)/i.test(normalized)) return selectedGroupId ? setSelectedGroupField("note", normalized.replace(/^메모\s+/i, "")) : setSelectedNodeField("note", normalized.replace(/^메모\s+/i, ""));
  if (/^링크\s+(.+)/i.test(normalized)) return setSelectedNodeField("link", normalized.replace(/^링크\s+/i, ""));
  if (/^하위\s+(.+)/i.test(normalized)) return addChildToSelected(normalized.replace(/^하위\s+/i, ""));
  createNode(normalized);
}

function findNodeByReference(reference) {
  const text = (reference || "").trim();
  if (!text) return null;
  const exact = state.nodes.find((node) => node.id === text || node.text === text);
  if (exact) return exact;
  return state.nodes.find((node) => node.text.includes(text));
}

function connectFromCommand(command) {
  if (!selectedIds.length) return announceAction("연결할 시작 노드를 선택하세요.");
  const targetText = command.replace(/^(연결|connect)\b/i, "").replace(/(다른노드|to|with|과|와)$/i, "").trim();
  let target = findNodeByReference(targetText);
  if (!target) target = state.nodes.find((node) => node.id !== selectedIds[0]);
  if (!target) return announceAction("연결할 다른 노드가 없습니다.");
  connectNodes(selectedIds[0], target.id);
}

function setSelectedNodeField(field, value) {
  if (!selectedIds.length) return announceAction("먼저 노드를 선택하세요.");
  setState((draft) => {
    draft.nodes = draft.nodes.map((node) => (
      selectedIds.includes(node.id) ? { ...node, [field]: value } : node
    ));
    return draft;
  });
  announceAction(`명령: updateNode("${selectedIds.join(",")}", { ${field} })`);
}

function setSelectedGroupTitle(value) {
  setSelectedGroupField("title", value);
}

function setSelectedGroupField(field, value) {
  const id = selectedGroupId;
  if (!id) return;
  setState((draft) => {
    draft.groups = draft.groups.map((group) => (
      group.id === id ? { ...group, [field]: value } : group
    ));
    if (["fill", "textColor", "fontFamily", "fontSize"].includes(field)) {
      draft.nodes = draft.nodes.map((node) => (
        node.groupId === id ? { ...node, [field]: value } : node
      ));
    }
    return draft;
  });
  selectedGroupId = id;
  announceAction(`명령: updateGroup("${id}", { ${field} })`);
}

function addChildToSelected(text) {
  const id = selectedIds[0];
  if (!id) return announceAction("먼저 노드를 선택하세요.");
  setState((draft) => {
    draft.nodes = draft.nodes.map((node) => (
      node.id === id ? { ...node, children: [...node.children, text] } : node
    ));
    return draft;
  });
  announceAction(`명령: addChildContent("${id}")`);
}

function undo() {
  if (!historyStack.length) return announceAction("되돌릴 기록이 없습니다.");
  redoStack.push(clone(state));
  state = historyStack.pop();
  selectedIds = [];
  selectedGroupId = null;
  render();
  announceAction("명령: undo()");
}

function redo() {
  if (!redoStack.length) return announceAction("복구할 기록이 없습니다.");
  historyStack.push(clone(state));
  state = redoStack.pop();
  selectedIds = [];
  selectedGroupId = null;
  render();
  announceAction("명령: redo()");
}

function resetSavedCanvas() {
  if (!window.confirm("저장된 캔버스 상태를 지우고 시작 노드로 다시 만들까요?")) return;
  clearSavedState();
  historyStack = [];
  redoStack = [];
  state = { nodes: [], edges: [], groups: [] };
  selectedIds = [];
  selectedGroupId = null;
  render();
  createNode("시작 아이디어", 260, 180, {
    note: "노드를 더블클릭하면 제목 입력칸에 바로 커서가 갑니다.",
    children: ["하위 콘텐츠 예시"]
  });
  centerCanvasOnContent();
  announceAction("저장된 캔버스를 초기화했습니다.");
}

function getTargetScreenBounds(shape) {
  const rect = shape.getClientRect({ relativeTo: stage });
  const scale = stage.scaleX();
  const stagePos = stage.position();
  return {
    x: rect.x * scale + stagePos.x,
    y: rect.y * scale + stagePos.y,
    width: rect.width * scale,
    height: rect.height * scale
  };
}

function updateInspector() {
  const node = selectedIds.length === 1 ? getNode(selectedIds[0]) : null;
  const group = !node && selectedGroupId ? getGroup(selectedGroupId) : null;
  detailPanel.hidden = suppressInspector || (!node && !group);

  if (!detailPanel.hidden) {
    detailPanel.style.position = "absolute";
    const targetShape = node ? nodeShapes.get(node.id) : group ? groupShapes.get(group.id) : null;
    if (targetShape) {
      const target = getTargetScreenBounds(targetShape);
      const canvasRect = canvasWrap.getBoundingClientRect();
      const panelWidth = Math.min(360, canvasRect.width - 32);
      const panelHeight = detailPanel.offsetHeight || 280;
      let left = target.x + target.width + 16;
      let top = target.y;
      if (left + panelWidth > canvasRect.width) {
        left = target.x - panelWidth - 16;
      }
      if (left < 12) {
        left = 12;
      }
      if (top + panelHeight > canvasRect.height) {
        top = Math.max(12, canvasRect.height - panelHeight - 16);
      }
      detailPanel.style.left = `${left}px`;
      detailPanel.style.top = `${Math.max(12, top)}px`;
      detailPanel.style.right = "";
    }
  }

  if (node) {
    detailType.textContent = "노드 상세";
    nodeStyleControls.classList.remove("is-hidden");
    noteLabel.classList.remove("is-hidden");
    linkLabel.classList.remove("is-hidden");
    payloadLabel.classList.remove("is-hidden");
    childContent.classList.remove("is-hidden");
    nodeText.value = node.text;
    nodeFill.value = toColorInput(node.fill);
    nodeTextColor.value = toColorInput(node.textColor);
    nodeFontFamily.value = node.fontFamily;
    nodeFontSize.value = node.fontSize;
    nodeNote.value = node.note;
    nodeLink.value = node.link;
    nodePayload.value = node.payload;
    childContent.textContent = node.children.length
      ? node.children.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "선택한 노드에 하위 콘텐츠가 없습니다.";
    return;
  }

  if (group) {
    detailType.textContent = "그룹 상세";
    nodeStyleControls.classList.remove("is-hidden");
    noteLabel.classList.remove("is-hidden");
    linkLabel.classList.add("is-hidden");
    payloadLabel.classList.add("is-hidden");
    childContent.classList.add("is-hidden");
    nodeText.value = group.title;
    nodeFill.value = toColorInput(group.fill || theme().node);
    nodeTextColor.value = toColorInput(group.textColor || theme().ink);
    nodeFontFamily.value = group.fontFamily || "Arial, Helvetica, sans-serif";
    nodeFontSize.value = group.fontSize || 15;
    nodeNote.value = group.note;
  }
}

function toColorInput(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  return "#ffffff";
}

nodeText.addEventListener("change", () => {
  if (selectedIds.length === 1) return setSelectedNodeField("text", nodeText.value);
  if (selectedGroupId) return setSelectedGroupTitle(nodeText.value);
});

[
  [nodeLink, "link"],
  [nodePayload, "payload"],
  [nodeFill, "fill"],
  [nodeTextColor, "textColor"],
  [nodeFontFamily, "fontFamily"],
  [nodeFontSize, "fontSize"]
].forEach(([input, field]) => {
  input.addEventListener("change", () => {
    const value = field === "fontSize" ? Number(input.value) : input.value;
    if (selectedGroupId) {
      setSelectedGroupField(field, value);
    } else {
      setSelectedNodeField(field, value);
    }
  });
});

nodeNote.addEventListener("change", () => {
  if (selectedIds.length === 1) return setSelectedNodeField("note", nodeNote.value);
  if (selectedGroupId) return setSelectedGroupField("note", nodeNote.value);
});

closeDetail.addEventListener("click", () => {
  selectedIds = [];
  selectedGroupId = null;
  render();
});

document.addEventListener("paste", (event) => {
  if (isEditableTarget(event.target)) return;
  const id = selectedIds[0];
  if (!id) return;
  const text = event.clipboardData?.getData("text/plain");
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!text && !imageItem) return;
  setSelectedNodeField("payload", imageItem ? `[clipboard image: ${imageItem.type}]` : text);
});

["dragenter", "dragover"].forEach((type) => {
  referenceDrop.addEventListener(type, (event) => {
    event.preventDefault();
    referenceDrop.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((type) => {
  referenceDrop.addEventListener(type, () => referenceDrop.classList.remove("dragging"));
});
referenceDrop.addEventListener("drop", async (event) => {
  event.preventDefault();
  await importReferenceFiles(Array.from(event.dataTransfer.files || []));
});
fileInput.addEventListener("change", async () => {
  await importReferenceFiles(Array.from(fileInput.files || []));
  fileInput.value = "";
});

async function importReferenceFiles(files) {
  for (const file of files) {
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      await importWorkbook(file);
      continue;
    }
    importHierarchy(await file.text(), file.name);
  }
}

async function importWorkbook(file) {
  if (!window.XLSX) {
    announceAction(`${file.name}: Excel 파서가 로드되지 않았습니다. CSV로 저장하거나 SheetJS CDN 연결을 확인하세요.`);
    return;
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const text = rows
      .map((row) => row.map((cell) => String(cell ?? "").trim()).join("\t"))
      .filter((line) => line.trim())
      .join("\n");
    importHierarchy(text, `${file.name}:${sheetName}`);
  });
}

function importHierarchy(text, sourceName) {
  const rows = parseHierarchyRows(text);
  if (!rows.length) return announceAction(`${sourceName}: 불러올 항목이 없습니다.`);
  const base = worldPointer();
  const created = [];
  setState((draft) => {
    const stack = [];
    rows.forEach((row, index) => {
      const id = nextId("node");
      draft.nodes.push({
        id,
        text: row.text,
        x: base.x + row.level * 240,
        y: base.y + index * 96,
        width: NODE.width,
        height: NODE.minHeight,
        groupId: null,
        note: `from ${sourceName}`,
        link: "",
        payload: "",
        children: [],
        fill: theme().node,
        textColor: theme().ink,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 15
      });
      created.push(id);
      const parent = stack[row.level - 1];
      if (parent) draft.edges.push({ id: nextId("edge"), from: parent, to: id, label: "" });
      stack[row.level] = id;
      stack.length = row.level + 1;
    });
    return draft;
  });
  selectedIds = created.slice(0, 1);
  render();
  announceAction(`명령: importReference("${sourceName}") 노드 ${created.length}개 생성`);
}

function parseHierarchyRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim())
    .map((line) => {
      const markdown = line.match(/^(\s*)(#{1,6})\s+(.+)/);
      if (markdown) return { level: markdown[2].length - 1, text: markdown[3].trim() };

      const bullet = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
      if (bullet) return { level: Math.floor(bullet[1].length / 2), text: bullet[3].trim() };

      const columns = line.split(/\t|,/).map((cell) => cell.trim());
      const filled = columns.map((cell, index) => ({ cell, index })).filter((item) => item.cell);
      if (filled.length > 1) {
        const last = filled[filled.length - 1];
        return { level: Math.max(0, last.index), text: last.cell };
      }

      const indent = line.match(/^(\s*)(.+)$/);
      return { level: Math.floor(((indent[1] || "").length) / 2), text: indent[2].trim() };
    });
}

window.addEventListener("resize", () => {
  stage.size({ width: canvasWrap.clientWidth, height: canvasWrap.clientHeight });
  stage.batchDraw();
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

function initializeCanvas() {
  const restored = loadStateFromStorage();
  if (restored) return;
  addMessage("더블 클릭: 제목 편집 / 노드 외곽 핸들: 크기 변경 / 우측 점 드래그: 연결 / Ctrl 클릭: 다중 선택", "system");
  createNode("시작 아이디어", 260, 180, {
    note: "노드를 더블클릭하면 제목 입력칸에 바로 커서가 갑니다.",
    children: ["하위 콘텐츠 예시"]
  });
}

initializeCanvas();

window.addEventListener("beforeunload", () => {
  saveStateToStorage();
});
