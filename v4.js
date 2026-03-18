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

        // Centralized Global Engine State (to prevent memory leaks from per-node listeners)
        this.globalMouseX = 0;
        this.globalMouseY = 0;
        this.globalScrollY = 0;
        this.globalWindowWidth = window.innerWidth;
        this.globalWindowHeight = window.innerHeight;

        window.addEventListener('mousemove', (e) => {
            this.globalMouseX = e.clientX;
            this.globalMouseY = e.clientY;
        });
        window.addEventListener('scroll', () => {
            this.globalScrollY = window.scrollY;
        });
        window.addEventListener('resize', () => {
            this.globalWindowWidth = window.innerWidth;
            this.globalWindowHeight = window.innerHeight;
        });
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

            // Initialize Network if configured in meta or root
            if (this.dataTree.meta && this.dataTree.meta.network) {
                this.initNetwork(this.dataTree.meta.network);
            }

            // Render root
            this.render();

        // --- INFINITE CANVAS PAN & ZOOM (BUILDER MODE ONLY) ---
        if (window.parent !== window) {
            let isPanning = false;
            let panStartX = 0, panStartY = 0;
            let currentPanX = 0, currentPanY = 0;
            let currentZoom = 1;

            this.rootElement.style.transformOrigin = '0 0';
            this.rootElement.style.width = '100vw';
            this.rootElement.style.height = '100vh';
            this.rootElement.style.position = 'absolute';
            this.rootElement.style.top = '0';
            this.rootElement.style.left = '0';

            const updateCanvasView = () => {
                this.rootElement.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
            };

            // Spacebar + Drag or Middle Mouse Button to Pan
            let spacePressed = false;
            // Global Click to close context menus
        window.addEventListener("click", () => {
            document.querySelectorAll(".v4-context-menu").forEach(m => m.remove());
        });

        // 3. Multi-Selection Marquee Box (Builder Mode)
        let marqueeBox = null; let startMarqueeX = 0, startMarqueeY = 0;

        document.body.addEventListener('mousedown', (e) => {
            if (e.target === document.body || e.target === this.rootElement) {
                document.querySelectorAll('[data-v4-selected]').forEach(el => { el.style.outline = el.getAttribute('data-v4-old-outline') || ''; el.style.outlineOffset = el.getAttribute('data-v4-old-offset') || ''; el.removeAttribute('data-v4-selected'); });
                document.querySelectorAll(".v4-resize-handle").forEach(h => h.remove());

                if (e.button === 0 && !e.shiftKey && !spacePressed) {
                    startMarqueeX = e.clientX; startMarqueeY = e.clientY;
                    marqueeBox = document.createElement('div');
                    marqueeBox.style.position = 'fixed'; marqueeBox.style.border = '1px solid rgba(0, 122, 204, 0.8)'; marqueeBox.style.backgroundColor = 'rgba(0, 122, 204, 0.1)'; marqueeBox.style.zIndex = '999999'; marqueeBox.style.pointerEvents = 'none'; marqueeBox.style.left = startMarqueeX + 'px'; marqueeBox.style.top = startMarqueeY + 'px'; marqueeBox.style.width = '0px'; marqueeBox.style.height = '0px';
                    document.body.appendChild(marqueeBox);
                }
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (marqueeBox) {
                marqueeBox.style.left = Math.min(startMarqueeX, e.clientX) + 'px'; marqueeBox.style.top = Math.min(startMarqueeY, e.clientY) + 'px';
                marqueeBox.style.width = Math.abs(e.clientX - startMarqueeX) + 'px'; marqueeBox.style.height = Math.abs(e.clientY - startMarqueeY) + 'px';
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (marqueeBox) {
                const boxRect = marqueeBox.getBoundingClientRect();
                const selectedPaths = [];
                document.querySelectorAll('[data-v4-path]').forEach(node => {
                    const nodeRect = node.getBoundingClientRect();
                    if (!(boxRect.right < nodeRect.left || boxRect.left > nodeRect.right || boxRect.bottom < nodeRect.top || boxRect.top > nodeRect.bottom)) {
                        node.setAttribute('data-v4-old-outline', node.style.outline || ''); node.setAttribute('data-v4-old-offset', node.style.outlineOffset || '');
                        node.style.outline = '2px solid #007acc'; node.style.outlineOffset = '-2px'; node.setAttribute('data-v4-selected', 'true');
                        selectedPaths.push(node.getAttribute('data-v4-path'));
                    }
                });
                if (selectedPaths.length > 0) window.parent.postMessage({ type: 'V4_NODE_SELECTED', path: selectedPaths[0], nodeData: this.findNodeByPath(this.dataTree, selectedPaths[0]) }, '*');
                marqueeBox.remove(); marqueeBox = null;
            }
        });

        document.body.addEventListener('dblclick', (e) => {
            if (e.target === document.body || e.target === this.rootElement) {
                this.exitIsolationMode();
            }
        });

        window.addEventListener('keydown', (e) => {
                if (e.code === 'Space' && e.target === document.body) {
                    e.preventDefault();
                    spacePressed = true;
                    document.body.style.cursor = 'grab';
                }
            });
            window.addEventListener('keyup', (e) => {
                if (e.code === 'Space') {
                    spacePressed = false;
                    if (!isPanning) document.body.style.cursor = 'default';
                }
            });

            window.addEventListener('mousedown', (e) => {
                if (e.button === 1 || (e.button === 0 && spacePressed)) {
                    e.preventDefault();
                    isPanning = true;
                    panStartX = e.clientX - currentPanX;
                    panStartY = e.clientY - currentPanY;
                    document.body.style.cursor = 'grabbing';
                }
            });

            window.addEventListener('mousemove', (e) => {
                if (!isPanning) return;
                currentPanX = e.clientX - panStartX;
                currentPanY = e.clientY - panStartY;
                updateCanvasView();
            });

            window.addEventListener('mouseup', (e) => {
                if (isPanning) {
                    isPanning = false;
                    document.body.style.cursor = spacePressed ? 'grab' : 'default';
                }
            });

            // Ctrl + Wheel to Zoom
            window.addEventListener('wheel', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const zoomSensitivity = 0.001;
                    const delta = -e.deltaY * zoomSensitivity;
                    const newZoom = Math.min(Math.max(0.1, currentZoom + delta), 5); // Clamped between 10% and 500%

                    const mouseX = e.clientX;
                    const mouseY = e.clientY;

                    currentPanX = mouseX - (mouseX - currentPanX) * (newZoom / currentZoom);
                    currentPanY = mouseY - (mouseY - currentPanY) * (newZoom / currentZoom);
                    currentZoom = newZoom;
                    updateCanvasView();
                }
            }, { passive: false });

            // Expose the zoom level globally so drag logic can compensate for scaled coordinates
            window.__v4CanvasZoom = () => currentZoom;
        }


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

        // --- Generador Procedural de Instancias ---
        if (nodeData.directives && nodeData.directives.instances && !nodeData.__isInstance) {
            const inst = nodeData.directives.instances;
            const cantidad = inst.count || 0;

            // Create a wrapper container to hold all instances cleanly
            const container = document.createElement('div');
            container.className = 'v4-instance-group';
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.pointerEvents = 'none'; // Let clicks pass through to underlying elements

            for (let i = 0; i < cantidad; i++) {
                const copia = JSON.parse(JSON.stringify(nodeData));
                delete copia.directives.instances;
                copia.__isInstance = true;

                // Randomize Base Transform
                let tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0, s = 1;

                if (inst.spread) {
                    tx = (Math.random() - 0.5) * (inst.spread.x || 0);
                    ty = (Math.random() - 0.5) * (inst.spread.y || 0);
                    tz = (Math.random() - 0.5) * (inst.spread.z || 0);
                }
                if (inst.rotate) {
                    rx = (Math.random() - 0.5) * (inst.rotate.x || 0);
                    ry = (Math.random() - 0.5) * (inst.rotate.y || 0);
                    rz = (Math.random() - 0.5) * (inst.rotate.z || 0);
                }
                if (inst.scale) {
                    s = (inst.scale.min || 1) + Math.random() * ((inst.scale.max || 1) - (inst.scale.min || 1));
                }

                const existingTransform = copia.properties?.style?.transform || '';
                const randomTransform = `translate3d(${tx}px, ${ty}px, ${tz}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`.trim();

                if (!copia.properties) copia.properties = {};
                if (!copia.properties.style) copia.properties.style = {};
                copia.properties.style.transform = `${existingTransform} ${randomTransform}`.trim();

                // Allow instances to be clickable/interactive despite the wrapper
                copia.properties.style.pointerEvents = 'auto';

                this.mount(copia, container, depth + 1);
            }
            parentElement.appendChild(container);
            return container;
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
        }

        // --- Dynamic Transform Stacking (Física Avanzada V4) ---
        // Setup safe defaults
        node.style.setProperty('--base-transform', nodeData.properties?.style?.transform || 'translate3d(0,0,0)');
        node.style.setProperty('--dyn-drag', 'translate3d(0,0,0)');
        node.style.setProperty('--dyn-rotate', '');
        node.style.setProperty('--dyn-mouse-follow', 'translate3d(0,0,0)');
        node.style.setProperty('--dyn-look-at', 'rotateX(0deg) rotateY(0deg)');
        node.style.setProperty('--dyn-auto-animate', 'rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateY(0px)');

        node.style.transform = `var(--base-transform) var(--dyn-drag) var(--dyn-rotate) var(--dyn-scroll) var(--dyn-mouse-follow) var(--dyn-look-at) var(--dyn-auto-animate)`.trim();

        // Aplicar Propiedades (Atributos y Estilos)
        this.applyProperties(node, nodeData.properties);

        if (nodeData.path) {
            // Protocolo de Selección: Emisión de Path al inspector

            // 0.7 Visual Manipulation Controls (Scale / Rotate)
            node.addEventListener('click', (e) => {
                e.stopPropagation();

                // Only act in Builder mode
                if (window.parent === window) return;

                // Grouping Logic: If we are not in isolation mode for this node's parent,
                // and this node is part of a complex group (e.g., inside a hero section),
                // we should select the highest level parent that is considered a "Group".
                // For simplicity, any node with absolute positioning and children is a group.
                let targetNode = node;
                let targetData = nodeData;

                if (this.isolatedPath && !nodeData.path.startsWith(this.isolatedPath)) {
                    // Clicked completely outside the isolated group, exit isolation
                    this.exitIsolationMode();
                } else if (!this.isolatedPath && node.parentElement && node.parentElement !== this.rootElement) {
                    // We are deep in a tree, but not isolated. Bubble up selection to the highest 'absolute' parent
                    let parent = node.parentElement;
                    while (parent && parent !== this.rootElement && parent.hasAttribute('data-v4-path')) {
                        if (parent.style.position === 'absolute') {
                            targetNode = parent;
                            targetData = this.findNodeByPath(this.dataTree, parent.getAttribute('data-v4-path'));
                        }
                        parent = parent.parentElement;
                    }
                }

                const corners = ['nw', 'ne', 'se', 'sw'];
                corners.forEach(pos => {
                    const h = document.createElement('div');
                    h.className = `v4-resize-handle v4-resize-${pos}`;

                    h.addEventListener('mousedown', (ev) => {
                        ev.stopPropagation(); ev.preventDefault();
                        const startX = ev.clientX; const startY = ev.clientY;
                        const rect = node.getBoundingClientRect();
                        const startWidth = rect.width; const startHeight = rect.height;
                        const startLeft = parseFloat(node.style.left || rect.left);
                        const startTop = parseFloat(node.style.top || rect.top);

                        const zoom = window.__v4CanvasZoom ? window.__v4CanvasZoom() : 1;

                        const onMouseMove = (moveEvent) => {
                            const dx = (moveEvent.clientX - startX) / zoom;
                            const dy = (moveEvent.clientY - startY) / zoom;

                            let newWidth = startWidth; let newHeight = startHeight;
                            let newLeft = startLeft; let newTop = startTop;

                            if (pos.includes('e')) newWidth = startWidth + dx;
                            if (pos.includes('w')) { newWidth = startWidth - dx; newLeft = startLeft + dx; }
                            if (pos.includes('s')) newHeight = startHeight + dy;
                            if (pos.includes('n')) { newHeight = startHeight - dy; newTop = startTop + dy; }

                            // Prevent negative sizes
                            if (newWidth > 10) { node.style.width = newWidth + 'px'; node.style.left = newLeft + 'px'; }
                            if (newHeight > 10) { node.style.height = newHeight + 'px'; node.style.top = newTop + 'px'; }
                        };

                        const onMouseUp = () => {
                            document.removeEventListener('mousemove', onMouseMove);
                            document.removeEventListener('mouseup', onMouseUp);

                            this.updateNode(nodeData.path, {
                                properties: { style: { width: node.style.width, height: node.style.height, left: node.style.left, top: node.style.top } }
                            });
                            this.saveState();
                            window.parent.postMessage({ type: 'V4_NODE_SELECTED', path: nodeData.path, nodeData: this.findNodeByPath(this.dataTree, nodeData.path) }, '*');
                        };

                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                    });
                    node.appendChild(h);
                });

                // Create Rotation Handle
                const rLine = document.createElement('div'); rLine.className = 'v4-rotate-line'; node.appendChild(rLine);
                const rHandle = document.createElement('div'); rHandle.className = 'v4-rotate-handle';

                rHandle.addEventListener('mousedown', (ev) => {
                    ev.stopPropagation(); ev.preventDefault();
                    const rect = node.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    // Parse existing rotation from --dyn-rotate or base transform
                    const baseTransform = node.style.getPropertyValue('--base-transform') || '';
                    let currentRot = 0;
                    const rotMatch = baseTransform.match(/rotateZ\(([-.\d]+)deg\)/);
                    if (rotMatch) currentRot = parseFloat(rotMatch[1]);

                    const startAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI);

                    const onMouseMove = (moveEvent) => {
                        const currentAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * (180 / Math.PI);
                        let deltaAngle = currentAngle - startAngle;
                        let finalAngle = currentRot + deltaAngle + 90; // +90 because the handle is at the top

                        // Snap to 15 degrees if holding Shift
                        if (moveEvent.shiftKey) finalAngle = Math.round(finalAngle / 15) * 15;

                        node.style.setProperty('--dyn-rotate', `rotateZ(${finalAngle}deg)`);
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);

                        const finalRotStr = node.style.getPropertyValue('--dyn-rotate');
                        if (finalRotStr) {
                            let newBase = baseTransform.replace(/rotateZ\([-.\d]+deg\)/g, '').trim();
                            newBase = `${newBase} ${finalRotStr}`.trim();
                            node.style.setProperty('--base-transform', newBase);
                            node.style.setProperty('--dyn-rotate', '');

                            this.updateNode(nodeData.path, { properties: { style: { transform: newBase } } });
                            this.saveState();
                        }
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
                node.appendChild(rHandle);

                window.parent.postMessage({ type: 'V4_NODE_SELECTED', path: nodeData.path, nodeData: this.findNodeByPath(this.dataTree, nodeData.path) }, '*');
            });

            // 0.8 Allow receiving new items dropped from the Palette (HTML5 drop from outside iframe)
            node.addEventListener('dragover', (e) => {
                e.preventDefault(); // Necessary to allow dropping
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
            });

            node.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const newTag = e.dataTransfer.getData('v4/new-tag');
                const newText = e.dataTransfer.getData('v4/new-text');
                const newJsonStr = e.dataTransfer.getData('v4/new-json');

                if (newTag || newJsonStr) {
                    const zoom = window.__v4CanvasZoom ? window.__v4CanvasZoom() : 1;

                    // Spatial Drop Logic: Determine the effective container
                    let dropTargetNode = node;
                    let dropTargetPath = nodeData.path;
                    let dropRect = node.getBoundingClientRect();

                    if (!nodeData.children && node.parentElement !== this.rootElement) {
                        dropTargetNode = node.parentElement;
                        dropTargetPath = dropTargetNode.getAttribute('data-v4-path') || nodeData.path;
                        dropRect = dropTargetNode.getBoundingClientRect();
                    }

                    const dropX = (e.clientX - dropRect.left) / zoom;
                    const dropY = (e.clientY - dropRect.top) / zoom;

                    let newNode;
                    if (newJsonStr) {
                        try {
                            newNode = JSON.parse(newJsonStr);
                            newNode.id = 'node-' + Math.random().toString(36).substr(2, 9);
                            if (!newNode.properties) newNode.properties = {};
                            if (!newNode.properties.style) newNode.properties.style = {};
                            newNode.properties.style.position = 'absolute';
                            newNode.properties.style.left = dropX + 'px';
                            newNode.properties.style.top = dropY + 'px';
                        } catch (err) {
                            console.error("Invalid JSON payload from palette", err);
                            return;
                        }
                    } else {
                        newNode = {
                            id: 'node-' + Math.random().toString(36).substr(2, 9),
                            tag: newTag,
                            text: newText || '',
                            properties: { style: { position: 'absolute', left: dropX + 'px', top: dropY + 'px', padding: '10px', border: '1px dashed #7f8c8d' } }
                        };
                    }

                    this.addNodeToTreeAdvanced(dropTargetPath, newNode, 'inside');
                    this.saveState();
                }
            });


            // 1. Text Editing Visual & Group Isolation

            node.addEventListener('dblclick', (e) => {
                e.stopPropagation();

                // If it's a group (has children), enter isolation mode instead of text editing
                if (nodeData.children && nodeData.children.length > 0) {
                    this.enterIsolationMode(nodeData.path);
                    return;
                }

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


        }

        // Texto Seguro contra XSS (Sanitización)
        if (nodeData.text) {
            node.textContent = nodeData.text; // Native protection against XSS
        }


        // --- LÓGICAS DECLARATIVAS (COMPORTAMIENTOS DINÁMICOS) ---
        if (nodeData.directives) {

            // Mouse Follow (Lerp offset)
            if (nodeData.directives.mouseFollow) {
                const config = nodeData.directives.mouseFollow;
                const factor = config.factor || 0.1;
                const lerp = config.lerp || 0.1;
                let currentX = 0, currentY = 0;

                const updateFollow = () => {
                    if (!document.body.contains(node)) return; // Cleanup Memory
                    const targetX = (this.globalMouseX - this.globalWindowWidth / 2) * factor;
                    const targetY = (this.globalMouseY - this.globalWindowHeight / 2) * factor;

                    currentX += (targetX - currentX) * lerp;
                    currentY += (targetY - currentY) * lerp;
                    node.style.setProperty('--dyn-mouse-follow', `translate3d(${currentX}px, ${currentY}px, 0)`);
                    requestAnimationFrame(updateFollow);
                };
                requestAnimationFrame(updateFollow);
            }

            // Look At Mouse (3D Tilt)
            if (nodeData.directives.lookAtMouse) {
                const config = nodeData.directives.lookAtMouse;
                const maxRot = config.maxRotation || 15;
                const lerp = config.lerp || 0.1;
                let currentRX = 0, currentRY = 0;

                const updateTilt = () => {
                    if (!document.body.contains(node)) return; // Cleanup Memory
                    const xPct = (this.globalMouseX / this.globalWindowWidth) - 0.5;
                    const yPct = (this.globalMouseY / this.globalWindowHeight) - 0.5;
                    const targetRY = xPct * maxRot;
                    const targetRX = -yPct * maxRot;

                    currentRX += (targetRX - currentRX) * lerp;
                    currentRY += (targetRY - currentRY) * lerp;
                    node.style.setProperty('--dyn-look-at', `rotateX(${currentRX}deg) rotateY(${currentRY}deg)`);
                    requestAnimationFrame(updateTilt);
                };
                requestAnimationFrame(updateTilt);
            }


            // Interactive Scroll Parallax (Timeline Modifiers)
            if (nodeData.directives.scrollAnimate) {
                const config = nodeData.directives.scrollAnimate;
                const speedY = config.speedY || 0;
                const scaleSpeed = config.scale || 0;

                // Initialize safely
                if (!node.style.getPropertyValue('--dyn-scroll')) {
                    node.style.setProperty('--dyn-scroll', 'translate3d(0, 0px, 0) scale(1)');
                }

                let currentScroll = this.globalScrollY || 0;
                const lerp = 0.1;

                const updateScroll = () => {
                    if (!document.body.contains(node)) return; // Cleanup Memory
                    currentScroll += (this.globalScrollY - currentScroll) * lerp;

                    const dy = currentScroll * speedY;
                    const ds = 1 + (currentScroll * scaleSpeed);

                    node.style.setProperty('--dyn-scroll', `translate3d(0, ${dy}px, 0) scale(${ds})`);
                    requestAnimationFrame(updateScroll);
                };
                requestAnimationFrame(updateScroll);
            }

            // Auto Animate (Continuous looping animation)
            if (nodeData.directives.autoAnimate) {
                const config = nodeData.directives.autoAnimate;
                const speedX = config.rotateX || 0;
                const speedY = config.rotateY || 0;
                const speedZ = config.rotateZ || 0;
                const floatAmp = config.floatAmplitude || 0;
                const floatFreq = config.floatFrequency || 0.002;

                let rx = 0, ry = 0, rz = 0;

                const updateLoop = (time) => {
                    if (!document.body.contains(node)) return;
                    rx += speedX;
                    ry += speedY;
                    rz += speedZ;

                    const floatY = Math.sin(time * floatFreq) * floatAmp;
                    node.style.setProperty('--dyn-auto-animate', `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) translateY(${floatY}px)`);
                    requestAnimationFrame(updateLoop);
                };
                requestAnimationFrame(updateLoop);
            }

            // Color Cycle
            if (nodeData.directives.colorCycle) {
                const config = nodeData.directives.colorCycle;
                const colors = config.colors || ['#ff0000', '#00ff00', '#0000ff'];
                const prop = config.property || 'backgroundColor';
                const duration = config.duration || 3000;
                let index = 0;

                node.style.transition = `${node.style.transition ? node.style.transition + ',' : ''} ${prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase())} ${duration}ms linear`;

                const nextColor = () => {
                    if (!document.body.contains(node)) return;
                    node.style[prop] = colors[index];
                    index = (index + 1) % colors.length;
                    setTimeout(nextColor, duration);
                };
                nextColor();
            }
        }

        // Manejo de Formularios & Magnetic Data Binding (Reactividad Inversa)
        if (nodeData.directives && (nodeData.directives.sync || nodeData.directives.syncTarget) && (tag === 'input' || tag === 'textarea')) {
            node.value = nodeData.text || '';
            node.addEventListener('input', (e) => {
                const newVal = e.target.value;
                this.updateNode(nodeData.path, { text: newVal });

                if (nodeData.directives.syncTarget) {
                    // Actualizar el nodo destino mágicamente
                    this.updateNode(nodeData.directives.syncTarget, { text: newVal });
                }

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
                    e.dataTransfer.setData('v4/new-tag', (nodeData.properties?.attributes?.['data-tag']) || node.getAttribute('data-tag'));
                    e.dataTransfer.setData('v4/new-text', (nodeData.properties?.attributes?.['data-text']) || node.getAttribute('data-text'));
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

                // If it's already loaded
                if (node.contentDocument && node.contentDocument.readyState === 'complete') {
                    if (node.contentWindow) {
                        node.contentWindow.postMessage({ type: 'V4_GET_TREE' }, '*');
                    }
                }

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

                        // Advanced Materials
                        if (data.nodeData.properties && data.nodeData.properties.style) {
                            const styles = data.nodeData.properties.style;
                            updateInput('style-backgroundColor', styles.backgroundColor || '#ffffff');
                            updateInput('style-width', styles.width);
                            updateInput('style-height', styles.height);
                            updateInput('style-backdropFilter', styles.backdropFilter || styles['-webkit-backdrop-filter']);
                            updateInput('style-borderRadius', styles.borderRadius);
                            updateInput('style-boxShadow', styles.boxShadow);
                        }

                        // Parse Magic Directives
                        const d = data.nodeData.directives || {};
                        updateInput('dir-syncTarget', d.syncTarget || '');
                        updateInput('dir-autoAnimate-amp', d.autoAnimate?.floatAmplitude || '');
                        updateInput('dir-autoAnimate-freq', d.autoAnimate?.floatFrequency || '');
                        updateInput('dir-lookAtMouse-rot', d.lookAtMouse?.maxRotation || '');
                        updateInput('dir-mouseFollow-factor', d.mouseFollow?.factor || '');

                        // Parse 200% Canva Killer Directives
                        updateInput('dir-scrollAnimate-speedY', d.scrollAnimate?.speedY || '');
                        updateInput('dir-scrollAnimate-scale', d.scrollAnimate?.scale || '');

                        updateInput('dir-instances-count', d.instances?.count || '');
                        if (d.instances?.spread) {
                            updateInput('dir-instances-spread', `${d.instances.spread.x || 0}, ${d.instances.spread.y || 0}, ${d.instances.spread.z || 0}`);
                        } else {
                            updateInput('dir-instances-spread', '');
                        }

                        // Setup reactive patches
                        this.currentSelectedPath = data.path;
                    }

                });

                // Reactive Inputs
                const bindInput = (id, key, isStyle, directivePath) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('input', (e) => {
                            if (!this.currentSelectedPath) return;

                            let patch = {};
                            if (isStyle) {
                                patch = { properties: { style: { [key]: e.target.value } } };
                            } else if (directivePath) {
                                // e.g. directivePath = ['autoAnimate', 'floatAmplitude']
                                const val = parseFloat(e.target.value);
                                if (isNaN(val)) return; // Don't send empty strings to math

                                patch = { directives: {} };
                                patch.directives[directivePath[0]] = {};
                                patch.directives[directivePath[0]][directivePath[1]] = val;

                                // Default dependencies if enabling for first time
                                if (directivePath[0] === 'autoAnimate') {
                                    if (directivePath[1] === 'floatAmplitude') patch.directives.autoAnimate.floatFrequency = 0.002;
                                    if (directivePath[1] === 'floatFrequency') patch.directives.autoAnimate.floatAmplitude = 15;
                                }
                                if (directivePath[0] === 'lookAtMouse') patch.directives.lookAtMouse.lerp = 0.1;
                                if (directivePath[0] === 'mouseFollow') patch.directives.mouseFollow.lerp = 0.1;
                            } else {
                                patch = { [key]: e.target.value };
                            }

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
                    bindInput('style-backdropFilter', 'backdropFilter', true);
                    bindInput('style-borderRadius', 'borderRadius', true);
                    bindInput('style-boxShadow', 'boxShadow', true);
                    bindInput('dir-syncTarget', '', false, ['syncTarget']);

                    bindInput('dir-autoAnimate-amp', '', false, ['autoAnimate', 'floatAmplitude']);
                    bindInput('dir-autoAnimate-freq', '', false, ['autoAnimate', 'floatFrequency']);
                    bindInput('dir-lookAtMouse-rot', '', false, ['lookAtMouse', 'maxRotation']);
                    bindInput('dir-mouseFollow-factor', '', false, ['mouseFollow', 'factor']);

                    bindInput('dir-scrollAnimate-speedY', '', false, ['scrollAnimate', 'speedY']);
                    bindInput('dir-scrollAnimate-scale', '', false, ['scrollAnimate', 'scale']);
                    bindInput('dir-instances-count', '', false, ['instances', 'count']);

                    const instancesSpreadEl = document.getElementById('dir-instances-spread');
                    if (instancesSpreadEl) {
                        instancesSpreadEl.addEventListener('input', (e) => {
                            if (!this.currentSelectedPath) return;
                            const vals = e.target.value.split(',').map(v => parseFloat(v.trim()));
                            const spread = { x: vals[0] || 0, y: vals[1] || 0, z: vals[2] || 0 };
                            node.contentWindow.postMessage({ type: 'V4_BUILDER_PATCH', path: this.currentSelectedPath, patch: { directives: { instances: { spread: spread } } } }, '*');
                        });
                    }

                    // Global Mesh Theme Setup
                    const meshSelect = document.getElementById('global-mesh-theme');
                    if (meshSelect) {
                        meshSelect.addEventListener('change', (e) => {
                            node.contentWindow.postMessage({ type: 'V4_BUILDER_ACTION', action: 'GLOBAL_NETWORK', payload: e.target.value }, '*');
                            document.getElementById('save-status').textContent = 'Theme applied...';
                        });
                    }
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


    enterIsolationMode(path) {
        this.isolatedPath = path;

        // Remove selection from everyone
        document.querySelectorAll('.v4-selected').forEach(el => el.classList.remove('v4-selected'));
        document.querySelectorAll('.v4-resize-handle, .v4-rotate-handle, .v4-rotate-line').forEach(h => h.remove());

        // Visual indicator of isolation mode
        document.querySelectorAll('.v4-isolated').forEach(el => el.classList.remove('v4-isolated'));
        const node = this.nodeRegistry.get(path);
        if (node) {
            node.classList.add('v4-isolated');
            node.style.outline = '2px dashed #4ec9b0';
            node.style.outlineOffset = '4px';
        }

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'V4_BUILDER_ACTION', action: 'ENTER_ISOLATION', path: path }, '*');
        }
    }

    exitIsolationMode() {
        this.isolatedPath = null;
        document.querySelectorAll('.v4-isolated').forEach(el => {
            el.classList.remove('v4-isolated');
            el.style.outline = '';
        });
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'V4_BUILDER_ACTION', action: 'EXIT_ISOLATION' }, '*');
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

// --- RED INTERACTIVA (NETWORK MESH) ---
    initNetwork(config) {
        if (!config || config.type === 'none') return;
        let canvas = document.getElementById('v4-network-canvas');
        if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'v4-network-canvas'; canvas.style.position = 'fixed'; canvas.style.top = '0'; canvas.style.left = '0'; canvas.style.width = '100vw'; canvas.style.height = '100vh'; canvas.style.pointerEvents = 'none'; canvas.style.zIndex = '-1'; document.body.insertBefore(canvas, document.body.firstChild); }
        const ctx = canvas.getContext('2d'); const nodes = []; const mouse = { x: null, y: null }; let time = 0;
        const density = config.density || 50; const lineColor = config.lineColor || '#0ea5e9'; const glowColor = config.glowColor || '#7dd3fc'; const radius = config.radius || 150; const interaction = config.interaction || 'repel';

        const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; nodes.length = 0; const cols = Math.ceil(canvas.width / density) + 2; const rows = Math.ceil(canvas.height / density) + 2; for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) nodes.push({ baseX: i * density, baseY: j * density, x: i * density, y: j * density, col: i, row: j }); };
        window.addEventListener('resize', resize); window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }); window.addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });
        resize();

        const hexToRgba = (hex, alpha) => { const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16); return `rgba(${r}, ${g}, ${b}, ${alpha})`; };
        const drawLine = (n1, n2) => { let opacity = 0.3; if (mouse.x !== null) { const midX = (n1.x + n2.x) / 2; const midY = (n1.y + n2.y) / 2; const dist = Math.hypot(midX - mouse.x, midY - mouse.y); if (dist < radius) opacity = Math.min(1, 0.3 + (1 - (dist / radius)) * 0.5); } ctx.beginPath(); ctx.strokeStyle = hexToRgba(lineColor, opacity); ctx.lineWidth = 1; ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.stroke(); };

        const animate = () => {
            if (!document.getElementById('v4-network-canvas')) return;
            time += 0.01; ctx.clearRect(0, 0, canvas.width, canvas.height);
            nodes.forEach((n) => {
                let targetX = n.baseX + Math.sin(time + n.col * 0.3) * 3; let targetY = n.baseY + Math.cos(time + n.row * 0.3) * 3;
                if (mouse.x !== null) { const dx = n.baseX - mouse.x; const dy = n.baseY - mouse.y; const dist = Math.hypot(dx, dy); if (dist < radius) { const force = (radius - dist) / radius; const angle = Math.atan2(dy, dx); if (interaction === 'repel') { targetX += Math.cos(angle) * force * 40; targetY += Math.sin(angle) * force * 40; } if (interaction === 'wave') { const wave = Math.sin(dist * 0.05 - time * 3) * force * 25; targetX += Math.cos(angle) * wave; targetY += Math.sin(angle) * wave; } if (interaction === 'attract') { targetX -= Math.cos(angle) * force * 30; targetY -= Math.sin(angle) * force * 30; } } }
                n.x += (targetX - n.x) * 0.1; n.y += (targetY - n.y) * 0.1;
            });
            const cols = Math.ceil(canvas.width / density) + 2; const rows = Math.ceil(canvas.height / density) + 2;
            nodes.forEach((n, i) => {
                if (n.col < cols - 1) { const right = i + rows; if (right < nodes.length) drawLine(n, nodes[right]); }
                if (n.row < rows - 1) { const bottom = i + 1; if (bottom < nodes.length && nodes[bottom].col === n.col) drawLine(n, nodes[bottom]); }
                let size = 2; let gSize = 0; if (mouse.x !== null) { const dist = Math.hypot(n.x - mouse.x, n.y - mouse.y); if (dist < radius) { const p = 1 - (dist / radius); size = 2 + p * 3; gSize = p * 15; } }
                if (gSize > 0) { const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, gSize); grad.addColorStop(0, hexToRgba(glowColor, 0.6)); grad.addColorStop(1, 'transparent'); ctx.beginPath(); ctx.arc(n.x, n.y, gSize, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill(); }
                ctx.beginPath(); ctx.arc(n.x, n.y, size, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill();
            });
            requestAnimationFrame(animate);
        };
        animate();
    }

    // Algoritmo de Renderizado con Reconciliación Selectiva
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


    enterIsolationMode(path) {
        this.isolatedPath = path;

        // Remove selection from everyone
        document.querySelectorAll('.v4-selected').forEach(el => el.classList.remove('v4-selected'));
        document.querySelectorAll('.v4-resize-handle, .v4-rotate-handle, .v4-rotate-line').forEach(h => h.remove());

        // Visual indicator of isolation mode
        document.querySelectorAll('.v4-isolated').forEach(el => el.classList.remove('v4-isolated'));
        const node = this.nodeRegistry.get(path);
        if (node) {
            node.classList.add('v4-isolated');
            node.style.outline = '2px dashed #4ec9b0';
            node.style.outlineOffset = '4px';
        }

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'V4_BUILDER_ACTION', action: 'ENTER_ISOLATION', path: path }, '*');
        }
    }

    exitIsolationMode() {
        this.isolatedPath = null;
        document.querySelectorAll('.v4-isolated').forEach(el => {
            el.classList.remove('v4-isolated');
            el.style.outline = '';
        });
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'V4_BUILDER_ACTION', action: 'EXIT_ISOLATION' }, '*');
        }
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

                // Use a dedicated physics CSS variable to avoid destroying the Transform Stack
                let tx = parseFloat(domNode.getAttribute('data-v4-px') || '0');
                let ty = parseFloat(domNode.getAttribute('data-v4-py') || '0');

                // Culling Lógico (Sleep Mode)
                if (Math.abs(vx) > 0.0001 || Math.abs(vy) > 0.0001) {
                    tx += vx * dt;
                    ty += vy * dt;
                    domNode.setAttribute('data-v4-px', tx);
                    domNode.setAttribute('data-v4-py', ty);

                    // We hijack --dyn-drag to push physics offsets, or add a new var if needed.
                    // Let's just push it to --dyn-drag so it plays nice with the stack
                    domNode.style.setProperty('--dyn-drag', `translate3d(${tx}px, ${ty}px, 0)`);
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


        if (!document.getElementById('v4-canvas-styles')) {
            const style = document.createElement('style');
            style.id = 'v4-canvas-styles';
            style.innerHTML = `
                .v4-selected { outline: 2px solid #007acc; outline-offset: 0px; position: relative; cursor: move; }
                .v4-selected::after { content: attr(data-v4-tag); position: absolute; top: -20px; left: -2px; background: #007acc; color: white; padding: 2px 6px; font-size: 10px; border-radius: 2px 2px 0 0; text-transform: uppercase; z-index: 9999; pointer-events: none; }
                .v4-resize-handle { position: absolute; width: 10px; height: 10px; background: white; border: 1px solid #007acc; z-index: 10000; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
                .v4-resize-nw { top: -5px; left: -5px; cursor: nwse-resize; }
                .v4-resize-ne { top: -5px; right: -5px; cursor: nesw-resize; }
                .v4-resize-se { bottom: -5px; right: -5px; cursor: nwse-resize; }
                .v4-resize-sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
                .v4-rotate-handle { position: absolute; width: 14px; height: 14px; background: transparent; border: 2px solid #ff00ff; border-radius: 50%; z-index: 10001; top: -25px; left: 50%; transform: translateX(-50%); cursor: grab; }
                .v4-rotate-line { position: absolute; width: 2px; height: 15px; background: #ff00ff; top: -10px; left: 50%; transform: translateX(-50%); z-index: 10000; }
                .v4-smart-guide { position: absolute; background-color: #ff00ff; z-index: 99999; pointer-events: none; }
            `;
            document.head.appendChild(style);
        }
        // Global Undo/Redo listeners

        // Global Click to close context menus
        window.addEventListener("click", () => {
            document.querySelectorAll(".v4-context-menu").forEach(m => m.remove());
        });

        document.body.addEventListener('dblclick', (e) => {
            if (e.target === document.body || e.target === this.rootElement) {
                this.exitIsolationMode();
            }
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

        if (action === 'GLOBAL_NETWORK') {
            const themes = {
                'solar': { density: 40, lineColor: '#f59e0b', glowColor: '#fbbf24', radius: 150, interaction: 'repel' },
                'ocean': { density: 25, lineColor: '#0ea5e9', glowColor: '#7dd3fc', radius: 220, interaction: 'wave' },
                'forest': { density: 55, lineColor: '#10b981', glowColor: '#6ee7b7', radius: 100, interaction: 'glow' },
                'sunset': { density: 30, lineColor: '#f43f5e', glowColor: '#fda4af', radius: 250, interaction: 'attract' },
                'purple': { density: 45, lineColor: '#8b5cf6', glowColor: '#ddd6fe', radius: 180, interaction: 'repel' },
                'minimal': { density: 80, lineColor: '#525252', glowColor: '#a3a3a3', radius: 80, interaction: 'glow' },
                'none': { type: 'none' }
            };

            if (!this.dataTree.meta) this.dataTree.meta = {};
            const selectedTheme = themes[payload] || themes['none'];
            if (payload !== 'none') selectedTheme.type = 'mesh';

            this.dataTree.meta.network = selectedTheme;

            // Clean old canvas and re-init
            const oldCanvas = document.getElementById('v4-network-canvas');
            if (oldCanvas) oldCanvas.remove();

            this.initNetwork(this.dataTree.meta.network);
            this.saveState();
            return;
        }
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
