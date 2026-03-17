/**
 * Ecosistema V4 - Motor de Renderizado (Runtime Core)
 * Intérprete de Datos de Alta Frecuencia sin generación de código.
 */

class V4Engine {
    constructor(rootId) {
        this.rootElement = document.getElementById(rootId);
        this.dataTree = null;
        this.memoryCamera = []; // Undo stack
        this.memoryIndex = -1;  // Current position
        this.masterNodes = {};
        this.nodeRegistry = new Map(); // path -> DOM Node
        this.lastFrameTime = 0;
        this.physicsNodes = [];
    }

    // -----------------------------------------------------
    // Core: Deep Merge (Regla de Oro: Objetos se fusionan, Arrays se sobrescriben)
    // -----------------------------------------------------
    deepMerge(target, source) {
        if (Array.isArray(source)) {
            return source;
        }
        if (typeof target === 'object' && target !== null && typeof source === 'object' && source !== null) {
            const result = Object.assign({}, target);
            for (const key in source) {
                if (source[key] === null) continue;
                if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(target[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        }
        return source;
    }

    // -----------------------------------------------------
    // Motor: Inicialización y Ciclo de Vida
    // -----------------------------------------------------
    async init(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();

            // Extract Master Nodes if present
            if (data.masterNodes) {
                this.masterNodes = data.masterNodes;
            }

            // Route handling setup
            this.setupRouting();

            // Builder Bridge
            this.setupBuilderBridge();

            // Set main tree
            this.dataTree = data.tree || data;
            this.saveState(); // Initial save

            // Render root
            this.render();

            // Start Physics Loop
            this.lastFrameTime = performance.now();
            requestAnimationFrame((time) => this.physicsLoop(time));

            // Notify Builder that engine is ready
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'V4_ENGINE_MOUNTED' }, '*');
                window.parent.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
            }

        } catch (e) {
            console.error("V4 Engine Error:", e);
        }
    }

    render() {
        this.rootElement.innerHTML = '';
        this.nodeRegistry.clear();
        this.physicsNodes = [];
        this.mount(this.dataTree.root, this.rootElement, 0);
        this.applySEO();
    }

    // A. Gestión de Ciclo de Vida: Montaje
    mount(nodeData, parentElement, depth) {
        if (depth > 32) {
            console.warn("V4: Límite de profundidad (32) alcanzado.", nodeData.path);
            return;
        }

        // Resolving Master Nodes (Instanciación por Referencia)
        if (nodeData.masterId && this.masterNodes[nodeData.masterId]) {
            const masterTemplate = JSON.parse(JSON.stringify(this.masterNodes[nodeData.masterId])); // Clone
            nodeData = this.deepMerge(masterTemplate, nodeData); // Apply specific patches
        }

        // Hydration de API
        if (nodeData.directives && nodeData.directives.fetch) {
            this.hydrateNode(nodeData, parentElement, depth);
            return; // Suspende renderizado hasta que la promesa resuelva
        }

        const tag = nodeData.tag || 'div';
        const node = document.createElement(tag);

        // Asignar ID
        if (nodeData.id) node.id = nodeData.id;

        // Registrar Path
        if (nodeData.path) {
            node.setAttribute('data-v4-path', nodeData.path);
            this.nodeRegistry.set(nodeData.path, node);

            // Protocolo de Selección: Emisión de Path al inspector
            node.addEventListener('click', (e) => {
                e.stopPropagation();

                // Visual Bounding Box (Only in Builder mode)
                if (window.parent !== window) {
                    document.querySelectorAll('[data-v4-selected]').forEach(el => {
                        el.style.outline = el.getAttribute('data-v4-old-outline') || '';
                        el.style.outlineOffset = el.getAttribute('data-v4-old-offset') || '';
                        el.removeAttribute('data-v4-selected');
                    });

                    node.setAttribute('data-v4-old-outline', node.style.outline || '');
                    node.setAttribute('data-v4-old-offset', node.style.outlineOffset || '');
                    node.style.outline = '2px solid #007acc';
                    node.style.outlineOffset = '-2px';
                    node.setAttribute('data-v4-selected', 'true');
                }

                if (window.parent !== window) {
                    window.parent.postMessage({
                        type: 'V4_NODE_SELECTED',
                        path: nodeData.path,
                        nodeData: nodeData
                    }, '*');
                }
            });
        }

        // Aplicar Propiedades (Atributos y Estilos)
        this.applyProperties(node, nodeData.properties);

        // --- MODOS VISUALES (CANVAS INTERACTIVO) ---
        if (window.parent !== window) {
            node.setAttribute('data-v4-tag', tag);


            // 0. Image Editing (Doble clic en imagenes)
            if (tag === "img") {
                node.addEventListener("dblclick", (e) => {
                    e.stopPropagation();
                    const url = prompt("Enter Image URL:", node.getAttribute("src") || "");
                    if (url !== null) {
                        if (!nodeData.properties) nodeData.properties = {};
                        if (!nodeData.properties.attributes) nodeData.properties.attributes = {};
                        nodeData.properties.attributes.src = url;
                        node.setAttribute("src", url);
                        this.updateNode(nodeData.path, { properties: { attributes: { src: url } } });
                        this.saveState();
                    }
                });
            }

            // 0.5 Context Menu
            node.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                e.stopPropagation();

                document.querySelectorAll(".v4-context-menu").forEach(m => m.remove());

                const menu = document.createElement("div");
                menu.className = "v4-context-menu";
                menu.style.position = "fixed";
                menu.style.background = "#252526";
                menu.style.border = "1px solid #454545";
                menu.style.boxShadow = "0 4px 6px rgba(0,0,0,0.5)";
                menu.style.zIndex = "99999";
                menu.style.borderRadius = "4px";
                menu.style.padding = "4px 0";
                menu.style.color = "#d4d4d4";
                menu.style.fontFamily = "sans-serif";
                menu.style.fontSize = "12px";
                menu.style.minWidth = "120px";

                const styleBtn = (btn) => {
                    btn.style.padding = "6px 12px";
                    btn.style.cursor = "pointer";
                    btn.addEventListener('mouseenter', () => { btn.style.background = "#007acc"; btn.style.color = "white"; });
                    btn.addEventListener('mouseleave', () => { btn.style.background = "transparent"; btn.style.color = "#d4d4d4"; });
                };

                menu.style.left = e.clientX + "px";
                menu.style.top = e.clientY + "px";

                const duplicateBtn = document.createElement("div");
                duplicateBtn.textContent = "⧉ Duplicate";
                styleBtn(duplicateBtn);
                duplicateBtn.onclick = () => {
                    this.handleBuilderAction({ action: "DUPLICATE", path: nodeData.path });
                    this.saveState();
                    menu.remove();
                };

                const deleteBtn = document.createElement("div");
                deleteBtn.textContent = "× Delete";
                styleBtn(deleteBtn);
                deleteBtn.style.color = "#ff6b6b";
                deleteBtn.onclick = () => {
                    this.handleBuilderAction({ action: "DELETE", path: nodeData.path });
                    this.saveState();
                    menu.remove();
                };

                menu.appendChild(duplicateBtn);
                menu.appendChild(deleteBtn);
                document.body.appendChild(menu);
            });

            // 0.7 Resize Handles Logic (Injected on selection click)
            node.addEventListener('click', (e) => {
                // Remove existing handles from everywhere
                document.querySelectorAll(".v4-resize-handle").forEach(h => h.remove());

                // Add handles to current node
                const createHandle = (pos) => {
                    const h = document.createElement("div");
                    h.className = `v4-resize-handle v4-resize-${pos}`;
                    h.style.position = "absolute";
                    h.style.width = "8px";
                    h.style.height = "8px";
                    h.style.background = "white";
                    h.style.border = "1px solid #007acc";
                    h.style.zIndex = "10000";
                    if (pos === "se") { h.style.bottom = "-4px"; h.style.right = "-4px"; h.style.cursor = "se-resize"; }
                    if (pos === "e") { h.style.top = "50%"; h.style.right = "-4px"; h.style.transform = "translateY(-50%)"; h.style.cursor = "e-resize"; }
                    if (pos === "s") { h.style.bottom = "-4px"; h.style.left = "50%"; h.style.transform = "translateX(-50%)"; h.style.cursor = "s-resize"; }


                    h.addEventListener("mousedown", (ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();

                        const startX = ev.clientX;
                        const startY = ev.clientY;
                        const startWidth = node.getBoundingClientRect().width;
                        const startHeight = node.getBoundingClientRect().height;

                        const onMouseMove = (moveEvent) => {
                            if (pos.includes("e")) node.style.width = (startWidth + (moveEvent.clientX - startX)) + "px";
                            if (pos.includes("s")) node.style.height = (startHeight + (moveEvent.clientY - startY)) + "px";
                        };

                        const onMouseUp = () => {
                            document.removeEventListener("mousemove", onMouseMove);
                            document.removeEventListener("mouseup", onMouseUp);

                            // Save to Engine
                            const partialData = { properties: { style: {} } };
                            if (pos.includes("e")) partialData.properties.style.width = node.style.width;
                            if (pos.includes("s")) partialData.properties.style.height = node.style.height;

                            this.updateNode(nodeData.path, partialData);
                            this.saveState();

                            // Notify Builder
                            window.parent.postMessage({ type: "V4_NODE_SELECTED", path: nodeData.path, nodeData: this.findNodeByPath(this.dataTree, nodeData.path) }, "*");
                        };

                        document.addEventListener("mousemove", onMouseMove);
                        document.addEventListener("mouseup", onMouseUp);
                    });
                    node.appendChild(h);
                };

                createHandle("se");
                createHandle("e");
                createHandle("s");
            });

            // 1. Text Editing Visual

            node.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                node.setAttribute('contenteditable', 'true');
                node.focus();
                node.style.outline = '2px dashed #007acc';
            });
            node.addEventListener('blur', (e) => {
                if (node.getAttribute('contenteditable') === 'true') {
                    node.removeAttribute('contenteditable');
                    node.style.outline = '';
                    const newText = node.textContent;
                    this.updateNode(nodeData.path, { text: newText });
                    this.saveState();
                    window.parent.postMessage({ type: 'V4_BUILDER_PATCH', path: nodeData.path, patch: { text: newText } }, '*');
                }
            });

            // 2. Drag & Drop Visual (Mover Elementos Directamente con Precisión)
            node.setAttribute('draggable', 'true');
            node.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                e.dataTransfer.setData('v4/path', nodeData.path);
                node.style.opacity = '0.5';
            });
            node.addEventListener('dragend', (e) => {
                e.stopPropagation();
                node.style.opacity = '1';
                document.querySelectorAll('.v4-drag-insert-before, .v4-drag-insert-after, .v4-drag-over').forEach(el => {
                    el.classList.remove('v4-drag-insert-before', 'v4-drag-insert-after', 'v4-drag-over');
                });
            });
            node.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const rect = node.getBoundingClientRect();
                const relativeY = e.clientY - rect.top;

                if (node.hasAttribute('data-v4-drag-pos')) {
                    if (node.getAttribute('data-v4-drag-pos') === 'before') node.style.borderTop = node.getAttribute('data-v4-old-borderTop') || '';
                    if (node.getAttribute('data-v4-drag-pos') === 'after') node.style.borderBottom = node.getAttribute('data-v4-old-borderBottom') || '';
                    if (node.getAttribute('data-v4-drag-pos') === 'inside') node.style.border = node.getAttribute('data-v4-old-border') || '';
                    node.removeAttribute('data-v4-drag-pos');
                }


                if (relativeY < rect.height / 4) {
                    node.setAttribute('data-v4-old-borderTop', node.style.borderTop); node.style.borderTop = '3px solid #e74c3c'; node.setAttribute('data-v4-drag-pos', 'before');
                    e.dataTransfer.dropEffect = 'move';
                } else if (relativeY > (rect.height * 3) / 4) {
                    node.setAttribute('data-v4-old-borderBottom', node.style.borderBottom); node.style.borderBottom = '3px solid #e74c3c'; node.setAttribute('data-v4-drag-pos', 'after');
                    e.dataTransfer.dropEffect = 'move';
                } else {
                    node.setAttribute('data-v4-old-border', node.style.border); node.style.border = '2px dashed #e67e22'; node.setAttribute('data-v4-drag-pos', 'inside');
                    e.dataTransfer.dropEffect = 'copy';
                }
            });
            node.addEventListener('dragleave', (e) => {

                if (node.hasAttribute('data-v4-drag-pos')) {
                    if (node.getAttribute('data-v4-drag-pos') === 'before') node.style.borderTop = node.getAttribute('data-v4-old-borderTop') || '';
                    if (node.getAttribute('data-v4-drag-pos') === 'after') node.style.borderBottom = node.getAttribute('data-v4-old-borderBottom') || '';
                    if (node.getAttribute('data-v4-drag-pos') === 'inside') node.style.border = node.getAttribute('data-v4-old-border') || '';
                    node.removeAttribute('data-v4-drag-pos');
                }

            });
            node.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const sourcePath = e.dataTransfer.getData('v4/path');
                const newTag = e.dataTransfer.getData('v4/new-tag');
                const newText = e.dataTransfer.getData('v4/new-text');

                const insertPos = node.getAttribute('data-v4-drag-pos') || 'inside';

                if (node.hasAttribute('data-v4-drag-pos')) {
                    if (node.getAttribute('data-v4-drag-pos') === 'before') node.style.borderTop = node.getAttribute('data-v4-old-borderTop') || '';
                    if (node.getAttribute('data-v4-drag-pos') === 'after') node.style.borderBottom = node.getAttribute('data-v4-old-borderBottom') || '';
                    if (node.getAttribute('data-v4-drag-pos') === 'inside') node.style.border = node.getAttribute('data-v4-old-border') || '';
                    node.removeAttribute('data-v4-drag-pos');
                }


                if (newTag) {
                    const newNode = {
                        id: 'node-' + Math.random().toString(36).substr(2, 9),
                        tag: newTag,
                        text: newText || '',
                        properties: { style: { padding: '10px', margin: '5px', border: '1px dashed #7f8c8d' } }
                    };
                    this.addNodeToTreeAdvanced(nodeData.path, newNode, insertPos);
                    this.saveState();
                } else if (sourcePath && sourcePath !== nodeData.path) {
                    this.moveNodeInTreeAdvanced(sourcePath, nodeData.path, insertPos);
                    this.saveState();
                }
            });
        }

        // Texto Seguro contra XSS (Sanitización)
        if (nodeData.text) {
            node.textContent = nodeData.text; // Native protection against XSS
        }

        // Manejo de Formularios (Reactividad Inversa)
        if (nodeData.directives && nodeData.directives.sync && (tag === 'input' || tag === 'textarea')) {
            node.value = nodeData.text || '';
            node.addEventListener('input', (e) => {
                this.updateNode(nodeData.path, { text: e.target.value });
                this.saveState();
            });
        }


        // Builder Logic Directives (Restaurado como Directivas Declarativas)
        if (nodeData.directives) {

            // 1. Initialize Tree View when loaded
            if (nodeData.directives.initTree) {
                this.treeViewContainer = node;
            }

            // 2. Refresh Tree Button
            if (nodeData.directives.refreshTree) {
                node.addEventListener('click', () => {
                    const iframe = document.getElementById('canvas');
                    if (iframe) iframe.contentWindow.postMessage({ type: 'V4_GET_TREE' }, '*');
                });
            }

            // 3. Make Palette Items Draggable
            if (nodeData.directives.paletteItem) {
                node.setAttribute('draggable', 'true');
                node.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('v4/new-tag', (nodeData.attributes && nodeData.attributes['data-tag']) || node.getAttribute('data-tag'));
                    e.dataTransfer.setData('v4/new-text', (nodeData.attributes && nodeData.attributes['data-text']) || node.getAttribute('data-text'));
                    e.dataTransfer.effectAllowed = 'copy';
                });
            }

            // 4. Listen to Iframe Selection (Outer Builder mode)
            if (nodeData.directives.iframeCanvas) {

                // Initialize engine when iframe mounts
                node.addEventListener('load', () => {
                    if (node.contentWindow) {
                        node.contentWindow.postMessage({ type: 'V4_GET_TREE' }, '*');
                    }
                });

                window.addEventListener('message', (event) => {
                    const data = event.data;
                    if (!data) return;

                    if (data.type === 'V4_ENGINE_MOUNTED') {
                        node.contentWindow.postMessage({ type: 'V4_GET_TREE' }, '*');
                    }
                    else if (data.type === 'V4_TREE_DATA') {
                        if (this.treeViewContainer) {
                            this.treeViewContainer.innerHTML = '';
                            const roots = Array.isArray(data.tree) ? data.tree : [data.tree.root || data.tree];
                            roots.forEach(r => this.treeViewContainer.appendChild(this.createTreeNode(r, node)));
                        }
                    }
                    else if (data.type === 'V4_NODE_SELECTED') {
                        // Update Inspector Inputs based on ID
                        const updateInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
                        document.getElementById('no-selection').style.display = 'none';
                        document.getElementById('controls').style.display = 'block';

                        updateInput('prop-path', data.path);
                        updateInput('prop-tag', data.nodeData.tag || 'div');
                        updateInput('prop-text', data.nodeData.text || '');

                        if (data.nodeData.properties && data.nodeData.properties.style) {
                            const styles = data.nodeData.properties.style;
                            updateInput('style-backgroundColor', styles.backgroundColor || '#ffffff');
                            updateInput('style-width', styles.width);
                            updateInput('style-height', styles.height);
                        }

                        // Setup reactive patches
                        this.currentSelectedPath = data.path;
                    }
                });

                // Reactive Inputs
                const bindInput = (id, key, isStyle) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('input', (e) => {
                            if (!this.currentSelectedPath) return;
                            const patch = isStyle ? { properties: { style: {} } } : {};
                            if (isStyle) patch.properties.style[key] = e.target.value;
                            else patch[key] = e.target.value;
                            node.contentWindow.postMessage({ type: 'V4_BUILDER_PATCH', path: this.currentSelectedPath, patch: patch }, '*');
                            document.getElementById('save-status').textContent = 'Unsaved changes...';
                        });
                    }
                };

                // We use setTimeout to ensure elements are mounted
                setTimeout(() => {
                    bindInput('prop-tag', 'tag', false);
                    bindInput('prop-text', 'text', false);
                    bindInput('style-backgroundColor', 'backgroundColor', true);
                    bindInput('style-width', 'width', true);
                    bindInput('style-height', 'height', true);
                }, 500);
            }
        }

        // Physics registration
        if (nodeData.directives && nodeData.directives.physics) {
            this.physicsNodes.push({ domNode: node, data: nodeData, physics: nodeData.directives.physics });
        }

        // Recursión
        if (nodeData.children && Array.isArray(nodeData.children)) {
            for (const child of nodeData.children) {
                this.mount(child, node, depth + 1);
            }
        }

        parentElement.appendChild(node);
        return node;
    }


    createTreeNode(nodeData, iframeRef) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = "5px 0 5px 15px";
        wrapper.style.cursor = "pointer";
        wrapper.style.userSelect = "none";

        const label = document.createElement('div');
        label.style.display = "flex";
        label.style.justifyContent = "space-between";
        label.style.alignItems = "center";

        label.innerHTML = `<span style="color:#569cd6; font-weight:bold; margin-right:5px;">${nodeData.tag || 'div'}</span> <span style="color:#ce9178; font-size:11px;">${nodeData.id ? '#' + nodeData.id : ''}</span>`;

        label.onclick = (e) => {
            e.stopPropagation();
            iframeRef.contentWindow.postMessage({ type: 'V4_BUILDER_PATCH', path: nodeData.path, patch: {} }, '*'); // Dummy patch to trigger selection highlight conceptually, or just let engine know
        };
        wrapper.appendChild(label);

        if (nodeData.children && nodeData.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.style.marginLeft = "10px";
            childrenContainer.style.borderLeft = "1px solid #404040";
            nodeData.children.forEach(child => {
                childrenContainer.appendChild(this.createTreeNode(child, iframeRef));
            });
            wrapper.appendChild(childrenContainer);
        }
        return wrapper;
    }

    applyProperties(node, properties) {
        if (!properties) return;

        if (properties.style) {
            for (const key in properties.style) {
                node.style[key] = properties.style[key];
            }
        }

        if (properties.attributes) {
            for (const key in properties.attributes) {
                node.setAttribute(key, properties.attributes[key]);
            }
        }
    }

    // Hydration de API
    async hydrateNode(nodeData, parentElement, depth) {
        try {
            const url = nodeData.directives.fetch;
            const res = await fetch(url);
            const data = await res.json();

            const fetchedTree = data.children ? data.children : (Array.isArray(data) ? data : [data]);
            const dataPatch = { children: fetchedTree, directives: { fetch: null } };

            this.updateNode(nodeData.path, dataPatch);
            this.saveState();

        } catch (e) {
            console.error("Hydration failed for", nodeData.path, e);
        }
    }

    // Algoritmo de Renderizado con Reconciliación Selectiva
    updateNode(path, partialData) {
        const domNode = this.nodeRegistry.get(path);
        const nodeData = this.findNodeByPath(this.dataTree, path);

        if (!nodeData) return;

        // Fusión Profunda en el Árbol Global
        const isAtomicStyle = partialData.properties && partialData.properties.style && Object.keys(partialData).length === 1 && Object.keys(partialData.properties).length === 1;

        if (isAtomicStyle && domNode) {
            // Reconciliación Selectiva: APLICAR_CAMBIO_DIRECTO
            for (const key in partialData.properties.style) {
                domNode.style[key] = partialData.properties.style[key];
                if (!nodeData.properties) nodeData.properties = { style: {} };
                if (!nodeData.properties.style) nodeData.properties.style = {};
                nodeData.properties.style[key] = partialData.properties.style[key];
            }
        } else {
            // Reconstruir Rama
            this.applyPatchToTree(nodeData, partialData);
            if (domNode && domNode.parentNode) {
                const parent = domNode.parentNode;
                const nextSibling = domNode.nextSibling;
                this.unmount(domNode);

                const newNode = this.mount(nodeData, document.createElement('div'), 0); // Mount in temp container
                if (newNode) {
                    parent.insertBefore(newNode, nextSibling);
                }
            } else {
                this.render(); // Fallback if node not found in DOM
            }
        }

        // Notify Builder to update tree view
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
        }
    }

    applyPatchToTree(target, source) {
        for (const key in source) {
            if (key === 'children' && Array.isArray(source.children)) {
                target.children = source.children; // Arrays sobrescriben
            } else if (typeof source[key] === 'object' && source[key] !== null) {
                if (!target[key]) target[key] = {};
                target[key] = this.deepMerge(target[key], source[key]); // Objetos se fusionan
            } else {
                target[key] = source[key];
            }
        }
    }

    findNodeByPath(tree, path) {
        if (tree.path === path) return tree;
        if (tree.children) {
            for (const child of tree.children) {
                const res = this.findNodeByPath(child, path);
                if (res) return res;
            }
        }
        return null;
    }

    findParentNodeByPath(tree, path, parent = null) {
        if (tree.path === path) return parent;
        if (tree.children) {
            for (const child of tree.children) {
                const res = this.findParentNodeByPath(child, path, tree);
                if (res) return res;
            }
        }
        return null;
    }

    unmount(node) {
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }

    // Advanced Tree Operations
    addNodeToTreeAdvanced(targetPath, newNode, position) {
        const targetNode = this.findNodeByPath(this.dataTree, targetPath);
        const targetParent = this.findParentNodeByPath(this.dataTree, targetPath);
        if (!targetNode) return;

        if (position === 'inside') {
            if (!targetNode.children) targetNode.children = [];
            newNode.path = targetPath + '.children[' + targetNode.children.length + ']';
            targetNode.children.push(newNode);
        } else if (targetParent && targetParent.children) {
            const targetIndex = targetParent.children.findIndex(c => c.path === targetPath);
            if (position === 'before') targetParent.children.splice(targetIndex, 0, newNode);
            if (position === 'after') targetParent.children.splice(targetIndex + 1, 0, newNode);

            const updatePaths = (node, parentPath, idx) => {
                node.path = parentPath + '.children[' + idx + ']';
                if (node.children) node.children.forEach((c, i) => updatePaths(c, node.path, i));
            };
            targetParent.children.forEach((c, i) => updatePaths(c, targetParent.path, i));
        }

        this.render();
        if (window.parent !== window) window.parent.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
    }

    moveNodeInTreeAdvanced(sourcePath, targetPath, position) {
        const sourceNode = this.findNodeByPath(this.dataTree, sourcePath);
        const sourceParent = this.findParentNodeByPath(this.dataTree, sourcePath);
        if (!sourceNode || !sourceParent || targetPath.startsWith(sourcePath)) return;

        sourceParent.children = sourceParent.children.filter(c => c.path !== sourcePath);
        this.addNodeToTreeAdvanced(targetPath, sourceNode, position);
    }

    // B. Estándares de Física
    physicsLoop(time) {
        const dt = (time - this.lastFrameTime) / 1000;
        this.lastFrameTime = time;

        for (const item of this.physicsNodes) {
            const { domNode, physics } = item;
            if (physics.velocity) {
                const vx = physics.velocity.x || 0;
                const vy = physics.velocity.y || 0;

                // Mapear inercia/rotación
                const currentTransform = domNode.style.transform || '';

                let tx = 0, ty = 0;
                const match = currentTransform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
                if (match) {
                    tx = parseFloat(match[1]);
                    ty = parseFloat(match[2]);
                }

                // Culling Lógico (Sleep Mode)
                if (Math.abs(vx) > 0.0001 || Math.abs(vy) > 0.0001) {
                    tx += vx * dt;
                    ty += vy * dt;
                    domNode.style.transform = `translate(${tx}px, ${ty}px)`;
                }
            }
        }
        requestAnimationFrame((time) => this.physicsLoop(time));
    }

    // Routing Espacial & SEO Semántico
    setupRouting() {
        window.addEventListener('popstate', () => this.handleRoute());

        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'V4_ROUTE_CHANGE') {
                if (event.data.path) {
                    this.handleRoute(event.data.path);
                }
            }
        });
    }

    handleRoute(forcedPath = null) {
        const path = forcedPath || window.location.pathname;
        if (this.dataTree && this.dataTree.routes) {
            const routeDef = this.dataTree.routes[path] || this.dataTree.routes['/'];
            if (routeDef && routeDef.targetNodePath) {
                const targetNode = this.findNodeByPath(this.dataTree.root, routeDef.targetNodePath);
                if (targetNode) {
                    this.dataTree.root.children = [targetNode]; // Swap root children to show only the routed node
                    this.render();
                }
            }
        }
    }

    applySEO() {
        if (!this.dataTree || !this.dataTree.meta) return;
        const meta = this.dataTree.meta;
        if (meta.title) document.title = meta.title;

        const setMeta = (name, content) => {
            let el = document.querySelector(`meta[name="${name}"]`);
            if (!el) {
                el = document.createElement('meta');
                el.setAttribute('name', name);
                document.head.appendChild(el);
            }
            el.setAttribute('content', content);
        };

        if (meta.description) setMeta('description', meta.description);
    }

    // Cámara de Memoria (Undo/Redo)
    saveState() {
        if (!this.dataTree) return;
        const snapshot = JSON.stringify(this.dataTree);
        if (this.memoryIndex === -1 || snapshot !== this.memoryCamera[this.memoryIndex]) {
            this.memoryCamera = this.memoryCamera.slice(0, this.memoryIndex + 1);
            this.memoryCamera.push(snapshot);
            this.memoryIndex++;
            if (this.memoryCamera.length > 50) {
                this.memoryCamera.shift();
                this.memoryIndex--;
            }
        }
    }

    undo() {
        if (this.memoryIndex > 0) {
            this.memoryIndex--;
            this.dataTree = JSON.parse(this.memoryCamera[this.memoryIndex]);
            this.render();
            if (window.parent !== window) window.parent.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
        }
    }

    redo() {
        if (this.memoryIndex < this.memoryCamera.length - 1) {
            this.memoryIndex++;
            this.dataTree = JSON.parse(this.memoryCamera[this.memoryIndex]);
            this.render();
            if (window.parent !== window) window.parent.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
        }
    }

    // La Capa del Creador (The Builder Bridge)
    setupBuilderBridge() {

        // Global Undo/Redo listeners

        // Global Click to close context menus
        window.addEventListener("click", () => {
            document.querySelectorAll(".v4-context-menu").forEach(m => m.remove());
        });

        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) this.redo();
                else this.undo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
            }
        });

        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data) return;

            if (data.type === 'V4_GET_TREE') {
                event.source.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
                return;
            }

            if (data.type === 'V4_BUILDER_ACTION') {
                this.handleBuilderAction(data);
                this.saveState();
                return;
            }

            if (data.type === 'V4_BUILDER_PATCH') {
                if (data.path && data.patch) {
                    this.updateNode(data.path, data.patch);
                    this.saveState();
                }
            }
        });
    }

    handleBuilderAction(data) {
        const { action, path, payload } = data;
        const targetNode = this.findNodeByPath(this.dataTree, path);
        const parentNode = this.findParentNodeByPath(this.dataTree, path);

        if (action === 'ADD') {
            if (targetNode) {
                if (!targetNode.children) targetNode.children = [];
                const newNode = {
                    id: 'node-' + Math.random().toString(36).substr(2, 9),
                    tag: payload.tag || 'div',
                    path: path + '.children[' + targetNode.children.length + ']',
                    properties: { style: { minHeight: '50px', backgroundColor: '#e0e0e0', border: '1px dashed #999', padding: '10px' } },
                    text: 'New Node'
                };
                targetNode.children.push(newNode);
                this.render();
            }
        } else if (action === 'DELETE') {
            if (parentNode && parentNode.children) {
                parentNode.children = parentNode.children.filter(c => c.path !== path);
                this.render();
            }
        } else if (action === 'DUPLICATE') {
             if (parentNode && parentNode.children && targetNode) {
                 const index = parentNode.children.findIndex(c => c.path === path);
                 if (index !== -1) {
                     const cloned = JSON.parse(JSON.stringify(targetNode));
                     cloned.id = 'node-' + Math.random().toString(36).substr(2, 9);
                     // Update paths recursively (simple implementation for now)
                     const updatePaths = (node, parentPath, idx) => {
                         node.path = parentPath + '.children[' + idx + ']';
                         if (node.children) {
                             node.children.forEach((c, i) => updatePaths(c, node.path, i));
                         }
                     };
                     parentNode.children.splice(index + 1, 0, cloned);
                     parentNode.children.forEach((c, i) => updatePaths(c, parentNode.path, i));
                     this.render();
                 }
             }
        }

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'V4_TREE_DATA', tree: this.dataTree }, '*');
        }
    }
}
