// Animation Cards – Keyframe Engine
// Author: Helder Araujo (based on WireGraph2 core ideas)

/*
    State model
    -------------
    We support 3 keyframes (KF1, KF2, KF3) each with its own configuration:
        layout         : "stacked-random" | "stacked-group" | "wheel"
        cardCount      : int
        cardWidth      : float
        cardHeight     : float
        cardSpacing    : float   (spacing within layout)
        groupSpec      : { sizes: number[], strokeColors: string[] } | null (only KF2)
        camera         : { zoom, rotX, rotY, rotZ }

    We interpolate between numeric fields; for arrays (group sizes / stroke) we do discrete mapping.
*/

const EASING = (t) => { // cubic in-out
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

// -----------------------------------------------------------------------------
// DEFAULT KEYFRAMES
// -----------------------------------------------------------------------------

let keyframes = [
    {
        layout: "stacked-random",
        cardCount: 52,
        cardWidth: 0.1,
        cardHeight: 30,
        cardSpacing: 1,
        cardThickness: 0.1,
        groupSpec: null,
        camera: { zoom: 10, rotX: 0, rotY: 90, rotZ: 0 }
    },
    {
        layout: "stacked-group",
        cardCount: 50,
        cardWidth: 20,
        cardHeight: 10,
        cardSpacing: 1,
        cardThickness: 0.1,
        groupSpec: {
            sizes: [5,10,15,20,15,10,15,10], // percentage summing to 100
            strokeColors: ["#68B3BE", "#3C946A", "#FF5A87", "#D26E00", "#F9C3C0", "#D093D0", "#FFE600", "#89C6FF"]
        },
        camera: { zoom: 8, rotX: -35, rotY: -45, rotZ: 0 },
        groupSpacing: 3
    },
    {
        layout: "wheel",
        cardCount: 100,
        cardWidth: 20,
        cardHeight: 10,
        cardSpacing: 1,
        cardThickness: 0.1,
        groupSpec: null,
        camera: { zoom: 5, rotX: 90, rotY: 0, rotZ: 0 },
        groupSpacing: 5
    }
];

// -----------------------------------------------------------------------------
// Working structures
// -----------------------------------------------------------------------------
let cards = [];          // array of objects representing each visible card
let currentKF = 0;       // index of the currently displayed keyframe
let targetKF = 0;        // index we are animating to
let animStart = 0;       // millis when animation starts
let animDuration = 2000; // ms
let animating = false;

// choose which group transitions to wheel
let SELECTED_GROUP_FOR_WHEEL = 2; // zero‑based (3rd group)

let transitionDurations = {
    '0-1': 2000,
    '1-2': 2000,
    '2-0': 2000
};

function setup() {
    const canvasParent = select('#canvas-container');
    const c = createCanvas(canvasParent.width, canvasParent.height, WEBGL);
    c.parent(canvasParent);

    // build cards for initial keyframe
    applyKeyframe(keyframes[currentKF], true);

    setupUI();
}

function windowResized() {
    const canvasParent = select('#canvas-container');
    resizeCanvas(canvasParent.width, canvasParent.height);
}

// -----------------------------------------------------------------------------
// UI HANDLERS
// -----------------------------------------------------------------------------
function setupUI() {
    // panel toggle
    const panel = document.getElementById('sidePanel');
    document.getElementById('togglePanelBtn').addEventListener('click', () => {
        panel.classList.toggle('open');
        document.querySelector('.canvas-container').classList.toggle('shifted');
    });
    document.getElementById('closePanelBtn').addEventListener('click', () => {
        panel.classList.remove('open');
        document.querySelector('.canvas-container').classList.remove('shifted');
    });

    // tab switching (KF editors – just placeholder for now)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            // Immediately switch to this keyframe state
            const idx = ['kf1','kf2','kf3'].indexOf(tabId);
            currentKF = idx;
            applyKeyframe(keyframes[idx], true);
            renderState = JSON.parse(JSON.stringify(cards));
        });
    });

    // animate controls
    document.getElementById('animateForwardBtn').addEventListener('click', () => {
        const next = (currentKF + 1) % keyframes.length;
        startAnimationTo(next);
    });
    document.getElementById('animateBackwardBtn').addEventListener('click', () => {
        const prev = (currentKF - 1 + keyframes.length) % keyframes.length;
        startAnimationTo(prev);
    });

    // Generate parameter controls for each keyframe
    generateKeyframePanels();

    // Timing controls
    const timingDiv = document.createElement('div');
    timingDiv.className = 'timing-controls';
    const labels = ['0-1','1-2','2-0'];
    labels.forEach(lbl => {
        const wrap = document.createElement('div');
        wrap.style.marginTop = '8px';
        const lab = document.createElement('label');
        lab.textContent = `KF${lbl.replace('-','→')}: `;
        lab.style.marginRight = '6px';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min='100'; inp.value = transitionDurations[lbl]; inp.step='100';
        inp.addEventListener('input', () => { transitionDurations[lbl] = parseInt(inp.value) || 100; });
        wrap.appendChild(lab);
        wrap.appendChild(inp);
        timingDiv.appendChild(wrap);
    });
    document.querySelector('.side-panel .controls').appendChild(timingDiv);
}

// Helper: create labelled input row
function createInputRow(labelText, inputEl) {
    const row = document.createElement('div');
    row.className = 'input-row';
    const lab = document.createElement('label');
    lab.textContent = labelText;
    lab.style.marginRight = '8px';
    lab.style.minWidth = '110px';
    lab.style.display = 'inline-block';
    lab.style.fontSize = '12px';
    row.appendChild(lab);
    row.appendChild(inputEl);
    return row;
}

function generateKeyframePanels() {
    ['kf1','kf2','kf3'].forEach((tabId, idx)=>{
        const cont = document.getElementById(tabId);
        cont.innerHTML='';
        const kf = keyframes[idx];

        // Layout select
        const layoutSel = document.createElement('select');
        ['stacked-random','stacked-group','wheel'].forEach(v=>{
            const opt = document.createElement('option');
            opt.value=v; opt.textContent=v; layoutSel.appendChild(opt);
        });
        layoutSel.value=kf.layout;
        layoutSel.addEventListener('change',()=>{ kf.layout = layoutSel.value; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Layout', layoutSel));

        // Card count
        const countIn = document.createElement('input');
        countIn.type='number'; countIn.min='1'; countIn.value=kf.cardCount;
        countIn.addEventListener('input',()=>{ kf.cardCount=parseInt(countIn.value)||1; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Card Count', countIn));

        // Card width / height
        const widthIn=document.createElement('input'); widthIn.type='number'; widthIn.value=kf.cardWidth;
        widthIn.addEventListener('input',()=>{ kf.cardWidth=parseFloat(widthIn.value)||1; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Card Width', widthIn));

        const heightIn=document.createElement('input'); heightIn.type='number'; heightIn.value=kf.cardHeight;
        heightIn.addEventListener('input',()=>{ kf.cardHeight=parseFloat(heightIn.value)||1; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Card Height', heightIn));

        // Card thickness
        const thickIn=document.createElement('input'); thickIn.type='number'; thickIn.step='0.1'; thickIn.value=kf.cardThickness;
        thickIn.addEventListener('input',()=>{ kf.cardThickness=parseFloat(thickIn.value)||0.1; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Thickness', thickIn));

        // Spacing
        const spaceIn=document.createElement('input'); spaceIn.type='number'; spaceIn.step='0.1'; spaceIn.value=kf.cardSpacing;
        spaceIn.addEventListener('input',()=>{ kf.cardSpacing=parseFloat(spaceIn.value)||0.1; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Spacing', spaceIn));

        // After Spacing input, add Group Spacing
        if(tabId === 'kf2') {
            const grpSpaceIn = document.createElement('input');
            grpSpaceIn.type = 'number'; grpSpaceIn.step = '0.1'; grpSpaceIn.value = kf.groupSpacing || 0;
            grpSpaceIn.addEventListener('input', () => {
                kf.groupSpacing = parseFloat(grpSpaceIn.value) || 0;
                if(currentKF === idx) applyKeyframe(kf, true);
            });
            cont.appendChild(createInputRow('Group Spacing', grpSpaceIn));
        }

        // Camera zoom
        const zoomIn=document.createElement('input'); zoomIn.type='number'; zoomIn.step='0.1'; zoomIn.value=kf.camera.zoom;
        zoomIn.addEventListener('input',()=>{ kf.camera.zoom=parseFloat(zoomIn.value)||1; if(currentKF===idx){ applyKeyframe(kf,true);} });
        cont.appendChild(createInputRow('Zoom', zoomIn));

        // Camera rotations X,Y,Z
        ['rotX','rotY','rotZ'].forEach(axis=>{
            const inp=document.createElement('input'); inp.type='number'; inp.step='1'; inp.value=kf.camera[axis];
            inp.addEventListener('input',()=>{ kf.camera[axis]=parseFloat(inp.value)||0; if(currentKF===idx){ applyKeyframe(kf,true);} });
            cont.appendChild(createInputRow('Cam '+axis.toUpperCase(), inp));
        });
    });
}

// -----------------------------------------------------------------------------
// ANIMATION ENGINE
// -----------------------------------------------------------------------------
function startAnimationTo(kfIndex) {
    if (kfIndex === currentKF) return;
    targetKF = kfIndex;
    animStart = millis();
    // choose duration based on from->to
    const key = `${currentKF}-${kfIndex}`;
    animDuration = transitionDurations[key] || animDuration;
    animating = true;
}

function applyKeyframe(kf, immediate=false) {
    // regenerate card array if needed (count change)
    cards = [];
    for (let i = 0; i < kf.cardCount; i++) {
        const card = {
            x: 0, y: 0, z: 0,
            rotX: 0, rotY: 0, rotZ: 0,
            w: kf.cardWidth,
            h: kf.cardHeight,
            d: kf.cardThickness,
            stroke: '#ffffff',
            groupIndex: 0 // default
        };
        cards.push(card);
    }

    // helper to align card bottom on y=0
    const alignBottom = (c)=>{ c.y = -c.h/2; };

    if (kf.layout === 'stacked-random') {
        // Generate random heights once per keyframe
        if (!kf.randomHeights || kf.randomHeights.length !== kf.cardCount) {
            kf.randomHeights = [];
            let baseHeight = kf.cardHeight * 0.5;
            for (let i = 0; i < kf.cardCount; i++) {
                kf.randomHeights.push(baseHeight * random(0.8, 1.4));
            }
        }

        const startZ = -(kf.cardCount * kf.cardSpacing) / 2;
        for (let i = 0; i < cards.length; i++) {
            cards[i].z = startZ + i * kf.cardSpacing;
            cards[i].h = kf.randomHeights[i];
            alignBottom(cards[i]);
        }
    } else if (kf.layout === 'stacked-group') {
        const gaps = kf.groupSpacing || 5;
        const startZ = -(kf.cardCount * kf.cardSpacing + gaps*8) / 2;
        let zCursor = startZ;
        const grpSizes = kf.groupSpec.sizes.map(p => round((p/100) * kf.cardCount));
        let cardIndex = 0;
        let selCounter = 0;
        for (let g = 0; g < grpSizes.length; g++) {
            const strokeCol = kf.groupSpec.strokeColors[g % kf.groupSpec.strokeColors.length];
            for (let j=0; j<grpSizes[g]; j++) {
                if(cardIndex>=cards.length) break;
                const c = cards[cardIndex];
                c.z = zCursor;
                c.stroke = strokeCol;
                c.groupIndex = g;
                if(g === SELECTED_GROUP_FOR_WHEEL){
                    c.wheelIndex = selCounter++; // sequential order for wheel target
                }
                alignBottom(c);
                zCursor += kf.cardSpacing;
                cardIndex++;
            }
            zCursor += gaps;
        }
    } else if (kf.layout === 'wheel') {
        const radius = 40;
        for (let i = 0; i < cards.length; i++) {
            const angle = ((i + 0.5) / kf.cardCount) * TWO_PI;
            const c = cards[i];
            c.x = cos(angle) * radius;
            c.z = sin(angle) * radius;
            c.rotY = -angle + PI;
            c.groupIndex = SELECTED_GROUP_FOR_WHEEL;
            c.wheelIndex = i;
            alignBottom(c);
        }
    }

    // store kf camera into global config
    cameraState.zoom = kf.camera.zoom;
    cameraState.rotX = kf.camera.rotX;
    cameraState.rotY = kf.camera.rotY;
    cameraState.rotZ = kf.camera.rotZ;

    if (immediate) {
        renderState = JSON.parse(JSON.stringify(cards)); // deep copy to renderState used in draw()
    }
}

// We keep renderState separate for interpolation
let renderState = [];

// simple camera holder
let cameraState = { zoom:1, rotX:0, rotY:0, rotZ:0 };
let renderCamera = { zoom:1, rotX:0, rotY:0, rotZ:0 };

// Y‑offset applied to the selected group while waiting on KF2
let standbyYOffset = 0;

// Hover interaction state (only used on KF2)
let hoveredGroup = null;

function mousePressed() {
    if (currentKF === 1 && !animating && hoveredGroup != null) {
        SELECTED_GROUP_FOR_WHEEL = hoveredGroup;
        // Start KF2 -> KF3 transition
        startAnimationTo(2); // KF3 index is 2
    }
}

function interpolateStates(fromKF, toKF, t) {
    // interpolate numeric camera params
    renderCamera.zoom = lerp(fromKF.camera.zoom, toKF.camera.zoom, t);
    renderCamera.rotX = lerp(fromKF.camera.rotX, toKF.camera.rotX, t);
    renderCamera.rotY = lerp(fromKF.camera.rotY, toKF.camera.rotY, t);
    renderCamera.rotZ = lerp(fromKF.camera.rotZ, toKF.camera.rotZ, t);

    // interpolate card count (spawn/despawn)
    const maxCount = max(fromKF.cardCount, toKF.cardCount);
    if (renderState.length < maxCount) {
        for (let i = renderState.length; i < maxCount; i++) {
            renderState.push({x:0,y:0,z:0,rotX:0,rotY:0,rotZ:0,w:20,h:30,stroke:'#fff',alive:0});
        }
    }

    // ensure we have positions precomputed for both keyframes
    let fromCards = [];
    let toCards = [];
    applyKeyframe(fromKF);
    fromCards = JSON.parse(JSON.stringify(cards));
    applyKeyframe(toKF);
    toCards = JSON.parse(JSON.stringify(cards));

    // Precompute anchor position of selected group in fromKF (for special transition)
    let groupAnchor = {x:0, y:0, z:0};
    if (fromKF.layout === 'stacked-group' && toKF.layout === 'wheel') {
        let sumX=0,sumY=0,sumZ=0,count=0;
        for(const c of fromCards){ if(c.groupIndex===SELECTED_GROUP_FOR_WHEEL){ sumX+=c.x; sumY+=c.y; sumZ+=c.z; count++; }}
        if(count>0){ groupAnchor={x:sumX/count,y:sumY/count,z:sumZ/count}; }
    }

    // ------------------------------------------------------------------
    // KF2 -> KF3 special transition (stacked‑group  -> wheel)
    // ------------------------------------------------------------------
    if (fromKF.layout === 'stacked-group' && toKF.layout === 'wheel') {
        // 1. originals
        const origMap = new Map();
        fromCards.forEach((c, idx)=>{
            if(c && c.groupIndex===SELECTED_GROUP_FOR_WHEEL && c.wheelIndex!==undefined){
                origMap.set(c.wheelIndex, {...c});
            }
        });

        const originals = Array.from(origMap.keys());

        const neededDup = [];
        for(let w=0; w<toCards.length; w++){
            if(!origMap.has(w)) neededDup.push(w);
        }
        neededDup.sort((a,b)=>a-b);
        const dupOrder={}; neededDup.forEach((w,order)=>dupOrder[w]=order);
        const spawnWindow=0.7;
        const delayPerDup = spawnWindow/Math.max(1,neededDup.length);
        const spawnDuration=0.3;

        // Determine original group stroke colour once for blending
        const originalGroupStroke = fromKF.groupSpec ? fromKF.groupSpec.strokeColors[SELECTED_GROUP_FOR_WHEEL % fromKF.groupSpec.strokeColors.length] : '#ffffff';

        for(let w=0; w<toCards.length; w++){
            const tc = toCards[w];
            const fc = origMap.get(w) || null;

            if(fc){
                const s = EASING(t);
                // Smoothly blend stroke colour like generic interpolation
                const colorBlend = constrain((t - 0.85) / 0.15, 0, 1);
                const blendedStroke = lerpColor(color(fc.stroke), color(tc.stroke), colorBlend);
                renderState[w] = {
                    x: lerp(fc.x, tc.x, s),
                    y: lerp(fc.y, tc.y, s),
                    z: lerp(fc.z, tc.z, s),
                    rotX: lerp(fc.rotX, tc.rotX, s),
                    rotY: lerp(fc.rotY, tc.rotY, s),
                    rotZ: lerp(fc.rotZ, tc.rotZ, s),
                    w: lerp(fc.w, tc.w, s),
                    h: lerp(fc.h, tc.h, s),
                    d: lerp(fc.d, tc.d, s),
                    stroke: blendedStroke,
                    groupIndex: tc.groupIndex,
                    alive: 1
                };
                continue;
            }
            if(dupOrder[w]!==undefined){
                const delay=dupOrder[w]*delayPerDup;
                const s=constrain((t-delay)/spawnDuration,0,1);
                // Smooth colour transition for spawned duplicates
                const colorBlend = constrain((t - 0.85) / 0.15, 0, 1);
                const blendedStroke = lerpColor(color(originalGroupStroke), color(tc.stroke), colorBlend);
                renderState[w]={x:lerp(groupAnchor.x,tc.x,s),y:lerp(groupAnchor.y,tc.y,s),z:lerp(groupAnchor.z,tc.z,s),rotX:lerp(0,tc.rotX,s),rotY:lerp(0,tc.rotY,s),rotZ:lerp(0,tc.rotZ,s),w:lerp(0,tc.w,s),h:lerp(0,tc.h,s),d:lerp(0,tc.d,s),stroke:blendedStroke,groupIndex:tc.groupIndex,alive:s};
                continue;
            }
            // collapse everything else (fromCards not in group) handled earlier; for wheel index without card just alive 0
            renderState[w]={groupIndex:null, alive:0};
        }
        // also collapse non‑selected group cards not part of wheel separately
        fromCards.forEach(c => {
            if (c.groupIndex !== SELECTED_GROUP_FOR_WHEEL) {
                const s = constrain(t * 3, 0, 1);              // collapse faster
                renderState[c.wheelIndex] = {
                    x: c.x,
                    y: c.y + lerp(0, c.h / 2, s),
                    z: c.z,
                    rotX: c.rotX,
                    rotY: c.rotY,
                    rotZ: c.rotZ,
                    w: lerp(c.w, 0, s),
                    h: lerp(c.h, 0, s),
                    d: lerp(c.d, 0, s),
                    stroke: c.stroke,
                    groupIndex: c.groupIndex,
                    alive: pow(1 - s, 2)                       // quadratic fade
                };
            }
        });
        return;
    }
    // ------------------------------------------------------------------

    // For generic transitions, set up some variables for ordered spawn/despawn 
    const spawnDelayPerCard = 0.005;
    const spawnDuration = 0.3;
    const specialTransition = fromKF.layout === 'stacked-group' || toKF.layout === 'stacked-group';
    const spawnOrderMap = {}; // default order by index

    for (let i = 0; i < maxCount; i++) {
        const fc = fromCards[i] || null;
        const tc = toCards[i] || null;

        const existFrom = fc !== null;
        const existTo   = tc !== null;
        if (!existFrom && existTo) {
            const order = spawnOrderMap[i] ?? 0;
            const delayStart = order * spawnDelayPerCard;
            const localT = constrain((t - delayStart) / spawnDuration, 0, 1);
            let startPos = {x: tc.x, y: tc.y, z: tc.z};
            if (specialTransition && tc.groupIndex === SELECTED_GROUP_FOR_WHEEL) {
                startPos = {...groupAnchor};
            }
            renderState[i] = {
                x: lerp(startPos.x, tc.x, localT),
                y: lerp(startPos.y, tc.y, localT),
                z: lerp(startPos.z, tc.z, localT),
                rotX: lerp(0, tc.rotX, localT),
                rotY: lerp(0, tc.rotY, localT),
                rotZ: lerp(0, tc.rotZ, localT),
                w: lerp(0, tc.w, localT),
                h: lerp(0, tc.h, localT),
                d: lerp(0, tc.d, localT),
                stroke: tc.stroke,
                groupIndex: tc.groupIndex,
                alive: localT
            };
        } else if (existFrom && !existTo) {
            // despawn generic
            renderState[i] = {
                x: fc.x,
                y: fc.y,
                z: fc.z,
                rotX: fc.rotX,
                rotY: fc.rotY,
                rotZ: fc.rotZ,
                w: lerp(fc.w, 0, t),
                h: lerp(fc.h, 0, t),
                d: lerp(fc.d||0.5, 0, t),
                stroke: fc.stroke,
                groupIndex: fc.groupIndex,
                alive: 1 - t
            };
        } else if (existFrom && existTo) {
            // normal interpolation with delayed color blend
            const colorBlend = constrain((t-0.85)/0.15,0,1);
            const blended = lerpColor(color(fc.stroke), color(tc.stroke), colorBlend);
            renderState[i] = {
                x: lerp(fc.x, tc.x, t),
                y: lerp(fc.y, tc.y, t),
                z: lerp(fc.z, tc.z, t),
                rotX: lerp(fc.rotX, tc.rotX, t),
                rotY: lerp(fc.rotY, tc.rotY, t),
                rotZ: lerp(fc.rotZ, tc.rotZ, t),
                w: lerp(fc.w, tc.w, t),
                h: lerp(fc.h, tc.h, t),
                d: lerp(fc.d||0.5, tc.d, t),
                stroke: blended,
                groupIndex: tc.groupIndex,
                alive:1
            };
        }
    }
}

function draw() {
    background(0);

    // ------------------------------------------------------------------
    // Hover detection (needs camera transform considered)
    // ------------------------------------------------------------------
    if (!animating && currentKF === 1) {
        // Build inverse transformation matrix from current renderCamera
        push();
        resetMatrix();
        // Apply inverse of camera to screen point
        // screen -> world
        const screenX = mouseX - width / 2;
        const screenY = mouseY - height / 2;
        // Inverse scale
        let wx = screenX / renderCamera.zoom;
        let wy = screenY / renderCamera.zoom;
        let wz = 0;
        // Inverse rotations (reverse order with negative angles)
        // Z
        let cosZ = cos(-radians(renderCamera.rotZ));
        let sinZ = sin(-radians(renderCamera.rotZ));
        let tx = wx * cosZ - wy * sinZ;
        let ty = wx * sinZ + wy * cosZ;
        wx = tx; wy = ty;
        // Y
        let cosY = cos(-radians(renderCamera.rotY));
        let sinY = sin(-radians(renderCamera.rotY));
        tx = wx * cosY + wz * sinY;
        let tz = -wx * sinY + wz * cosY;
        wx = tx; wz = tz;
        // X
        let cosX = cos(-radians(renderCamera.rotX));
        let sinX = sin(-radians(renderCamera.rotX));
        ty = wy * cosX - wz * sinX;
        tz = wy * sinX + wz * cosX;
        wy = ty; wz = tz;

        // Determine group near this world X,Z (ignore Y): measure distance in XZ plane to cards centre of each group
        let best = {g: null, dist: 1e9};
        for (const c of renderState) {
            if (c.groupIndex == null) continue;
            const d2 = dist(wx, wz, c.x, c.z);
            if (d2 < best.dist) best = {g: c.groupIndex, dist: d2};
        }
        hoveredGroup = best.dist < 40 ? best.g : null; // threshold tuned
        pop();
    } else {
        hoveredGroup = null;
    }

    // update standby offset when idle on KF2
    if (!animating && currentKF === 1) { // KF2 is index 1
        const target = (hoveredGroup != null) ? -10 : 0;
        standbyYOffset = lerp(standbyYOffset, target, 0.05);
    } else {
        standbyYOffset = lerp(standbyYOffset, 0, 0.2); // reset quicker when not idle on KF2
    }

    // time update
    if (animating) {
        const t = constrain((millis() - animStart) / animDuration, 0, 1);
        const eased = EASING(t);
        interpolateStates(keyframes[currentKF], keyframes[targetKF], eased);
        if (t >= 1) {
            animating = false;
            currentKF = targetKF;
            // preserve final blended colors rather than re-applying keyframe
        }
    }

    // apply camera transform
    push();
    scale(renderCamera.zoom);
    rotateX(radians(renderCamera.rotX));
    rotateY(radians(renderCamera.rotY));
    rotateZ(radians(renderCamera.rotZ));

    // lighting simple
    ambientLight(120);
    directionalLight(255,255,255, 0.5,0.5,-1);

    // draw cards with black fill
    fill(0);
    for (let c of renderState) {
        if (c.alive < 0.01) continue;
        if (c.w < 0.05 && c.h < 0.05 && c.d < 0.05) continue;
        push();
        const groupMatch = (currentKF === 1) && (
            (hoveredGroup != null && c.groupIndex === hoveredGroup) ||
            (animating && c.groupIndex === SELECTED_GROUP_FOR_WHEEL)
        );
        const extraY = groupMatch ? standbyYOffset : 0;
        translate(c.x, c.y + extraY, c.z);
        rotateX(c.rotX);
        rotateY(c.rotY);
        rotateZ(c.rotZ);
        const col = color(c.stroke);
        col.setAlpha(255 * c.alive);
        stroke(col);
        box(max(c.w,0.1), max(c.h,0.1), max(c.d||0.5,0.1));
        pop();
    }

    pop();
}