
(() => {
    if (window.__ANCHORCELL_WEBGL_STARTED__) return;
    window.__ANCHORCELL_WEBGL_STARTED__ = true;

    const canvas = document.getElementById('gl');

    if (!canvas) {
        document.documentElement.classList.add('no-webgl');
        window.__ANCHORCELL_WEBGL_STARTED__ = false;
        return;
    }

    function createGLContext(canvas) {
        const contextNames = ['webgl', 'experimental-webgl'];

        const optionSets = [
            { antialias: true, alpha: false },
            { antialias: false, alpha: false },
            { antialias: true, alpha: true },
            { antialias: false, alpha: true },
            {}
        ];

        for (const name of contextNames) {
            for (const opts of optionSets) {
                try {
                    const ctx = canvas.getContext(name, opts);

                    if (ctx) {
                        return ctx;
                    }
                } catch (err) {
                    // Try the next option set.
                }
            }
        }

        return null;
    }

    const gl = createGLContext(canvas);

    if (!gl) {
        document.documentElement.classList.remove('webgl-ready');
        document.documentElement.classList.add('no-webgl');
        window.__ANCHORCELL_WEBGL_STARTED__ = false;
        return;
    }

    document.documentElement.classList.remove('no-webgl');
    document.documentElement.classList.add('webgl-ready');

    const TAU = Math.PI * 2, MSD = 86400000, YR = 365.2422, LM = 29.530588853, C = { w: [1, 1, 1, 1], s: [.918, .878, .639, 1], m: [.651, .761, .937, 1], b: [0, 0, 0, 1] };
    const P = {
        starR: 1.5,
        bread: 25 * Math.PI / 180,
        sunOuter: 4.45,
        sunInner: 4.05,
        moonOuter: 2.76,
        moonInner: 2.36,
        thick: .04,
        arrowZ: .12,
        alpha: -40 * Math.PI / 180,
        beta: -52.5 * Math.PI / 180,
        obl: 23.44,
        linc: 5.14,
        declScale: 1.38,
        sunAng: 300 * Math.PI / 180,
        moonAng: 60 * Math.PI / 180,
        earthR: .15,
        earthH: .025,
        rayTargetScale: 2,
        axisInsetPx: 2.5
    };
    const START = { yaw: -Math.PI / 4 + 2.2, pitch: Math.atan(1 / Math.sqrt(2)) -0.25, zoom: 123.75757575757575, w: 1485, h: 1021 };
    const S = { yaw: START.yaw, pitch: START.pitch, zoom: START.zoom, play: true, ms: Date.now(), speed: 1, last: performance.now(), interactive: false, baseYaw: START.yaw, basePitch: START.pitch, targetYaw: START.yaw, targetPitch: START.pitch, readoutLast: 0, topEarth: false, zm: 1 };
    const $ = id => document.getElementById(id), dateTime = $('dateTime'), speed = $('speed'), uiPanel = $('uiPanel'), modeToggle = $('modeToggle'), siteOverlay = document.querySelector('.siteOverlay'), pageOverlay = $('pageOverlay'), pageBack = $('pageBack'), pageTitle = $('pageTitle'), pageBody = $('pageBody'), pageKicker = $('pageKicker'), labels = { sun: $('sunLabel'), moon: $('moonLabel'), earth: $('earthLabel'), stars: $('starsLabel'), N: $('nLabel'), S: $('sLabel') };
    const vs = `attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uM;uniform vec2 uRes;uniform float uZoom;uniform float uPoint;varying vec4 vCol;void main(){vec4 q=uM*vec4(aPos,1.);vec2 clip=vec2(q.x*uZoom/(uRes.x*.5),q.y*uZoom/(uRes.y*.5));gl_Position=vec4(clip,-q.z/96.,1.);gl_PointSize=uPoint;vCol=aCol;}`;
    const fs = `precision mediump float;varying vec4 vCol;void main(){gl_FragColor=vCol;}`;
    function sh(t, s) { let h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(h)); return h } let prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog); const loc = { pos: gl.getAttribLocation(prog, 'aPos'), col: gl.getAttribLocation(prog, 'aCol'), m: gl.getUniformLocation(prog, 'uM'), res: gl.getUniformLocation(prog, 'uRes'), zoom: gl.getUniformLocation(prog, 'uZoom'), point: gl.getUniformLocation(prog, 'uPoint') }, posBuf = gl.createBuffer(), colBuf = gl.createBuffer();
    const pathVS = `attribute vec3 aPrev;attribute vec3 aCurr;attribute vec3 aNext;attribute float aSide;attribute vec4 aCol;uniform mat4 uM;uniform vec2 uRes;uniform float uZoom;uniform float uThickness;varying vec4 vCol;vec4 project(vec3 p){vec4 q=uM*vec4(p,1.);return vec4(q.x*uZoom/(uRes.x*.5),q.y*uZoom/(uRes.y*.5),-q.z/96.,1.);}void main(){vec4 pp=project(aPrev),cc=project(aCurr),nn=project(aNext);float aspect=uRes.x/uRes.y;vec2 p=pp.xy*vec2(aspect,1.),c=cc.xy*vec2(aspect,1.),n=nn.xy*vec2(aspect,1.);vec2 d0=normalize(c-p),d1=normalize(n-c);vec2 tangent=normalize(d0+d1);if(length(tangent)<.01)tangent=d1;vec2 miter=vec2(-tangent.y,tangent.x);vec2 normal=vec2(-d1.y,d1.x);float denom=max(.25,abs(dot(miter,normal)));float len=(uThickness/uRes.y)/denom;vec2 off=miter*aSide*len;off.x/=aspect;gl_Position=cc;gl_Position.xy+=off;vCol=aCol;}`;
    let pathProg = gl.createProgram(); gl.attachShader(pathProg, sh(gl.VERTEX_SHADER, pathVS)); gl.attachShader(pathProg, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pathProg); const ploc = { prev: gl.getAttribLocation(pathProg, 'aPrev'), curr: gl.getAttribLocation(pathProg, 'aCurr'), next: gl.getAttribLocation(pathProg, 'aNext'), side: gl.getAttribLocation(pathProg, 'aSide'), col: gl.getAttribLocation(pathProg, 'aCol'), m: gl.getUniformLocation(pathProg, 'uM'), res: gl.getUniformLocation(pathProg, 'uRes'), zoom: gl.getUniformLocation(pathProg, 'uZoom'), thick: gl.getUniformLocation(pathProg, 'uThickness') }, pbuf = gl.createBuffer(), cbuf2 = gl.createBuffer(), nbuf = gl.createBuffer(), sbuf = gl.createBuffer(), pcol = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); try { gl.lineWidth(3) } catch (e) { }
    function v(x = 0, y = 0, z = 0) { return { x, y, z } } function add(a, b) { return v(a.x + b.x, a.y + b.y, a.z + b.z) } function sub(a, b) { return v(a.x - b.x, a.y - b.y, a.z - b.z) } function mul(a, s) { return v(a.x * s, a.y * s, a.z * s) } function norm(a) { let l = Math.hypot(a.x, a.y, a.z) || 1; return mul(a, 1 / l) } function basis() { let a = P.alpha, b = P.beta; return { axis: v(Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)), lx: v(Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), -Math.sin(b)), ly: v(-Math.sin(a), Math.cos(a), 0) } } function c2w(p) { let B = basis(); return add(add(mul(B.lx, p.x), mul(B.ly, p.y)), mul(B.axis, p.z)) } function rotMat() { let cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cx = Math.cos(S.pitch), sx = Math.sin(S.pitch); return new Float32Array([cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, 0, 1]) } function w2v(p) { let cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), x = cy * p.x + sy * p.z, z = -sy * p.x + cy * p.z, y = p.y, cx = Math.cos(S.pitch), sx = Math.sin(S.pitch); return { x, y: cx * y - sx * z, z: sx * y + cx * z } } function invView(q) { let cx = Math.cos(S.pitch), sx = Math.sin(S.pitch), cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), y = cx * q.y + sx * q.z, z = -sx * q.y + cx * q.z, x = q.x; return v(cy * x - sy * z, y, sy * x + cy * z) } function projectW(p) { let q = w2v(p), dpr = canvas.width / innerWidth; return { x: innerWidth / 2 + q.x * S.zoom / dpr, y: innerHeight / 2 - q.y * S.zoom / dpr, z: q.z } }
    function pad(n) { return String(n).padStart(2, '0') } function toInput(ms) { let d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) } function fromInput(s) { let t = new Date(s).getTime(); return Number.isFinite(t) ? t : S.ms }
    dateTime.value = toInput(S.ms);
    $('play').onclick = () => {
        S.play = !S.play;
        $('play').textContent = S.play ? 'pause' : 'resume'
    };
    $('reset').onclick = () => {
        S.yaw = S.baseYaw = S.targetYaw = START.yaw;
        S.pitch = S.basePitch = S.targetPitch = START.pitch;
        S.zoom = fitZoom() * (canvas.width / innerWidth);
    };
    $('now').onclick = () => {
        S.ms = Date.now();
        dateTime.value = toInput(S.ms)
    };
    function commitDateTimeInput() {
        S.ms = fromInput(dateTime.value);
        dateTime.value = toInput(S.ms); 
        readouts();
    }
    dateTime.oninput = () => {   
        let t = new Date(dateTime.value).getTime();   
        if (Number.isFinite(t)) S.ms = t;
    };
    dateTime.onchange = commitDateTimeInput;
    dateTime.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();        
            commitDateTimeInput();        
            dateTime.blur();    
        }
    });
    speed.oninput = () => S.speed = +speed.value;
    
    modeToggle.onclick = () => { S.interactive = !S.interactive; uiPanel.classList.toggle('show', S.interactive); siteOverlay.classList.toggle('interactiveHidden', S.interactive); modeToggle.textContent = S.interactive ? 'shun' : 'interact'; drag = null; S.baseYaw = S.yaw; S.basePitch = S.pitch; S.targetYaw = S.yaw; S.targetPitch = S.pitch };
    const COPY = window.ANCHORCELL_CONTENT || {},
        CURRENT_PAGE = window.ANCHORCELL_PAGE || {},
        ROUTES = { news: '/news/', shows: '/shows/', music: '/music/', videos: '/videos/' },
        PAGE = { mode: 'home', section: null, page: null, t0: 0, duration: 950 };

    function isNewsPath(pathname) {
        return pathname === '/news/' || /^\/news\/page\d+\/?$/.test(pathname);
    }
    async function fetchRenderedPage(url) {
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error('Could not load ' + url);
        }

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const root = doc.querySelector('.staticFallbackPage') || doc;
        const title = root.querySelector('.pageTitle');
        const kicker = root.querySelector('#pageKicker, .pageKicker');
        const body = root.querySelector('.pageBody');
        const back = root.querySelector('.pageBack');

        if (!body) {
            throw new Error('No page body found in ' + url);
        }

        return {
            type: 'fetched',
            key: url,
            title: title ? title.textContent.trim() : 'news',
            kicker: kicker ? kicker.textContent.trim() : 'anchorcell / news',
            backUrl: back ? back.getAttribute('href') || '/' : '/',
            backLabel: back ? back.textContent.trim() || 'Back' : 'Back',
            body: body.innerHTML
        };
    }

    function cleanPath(path) {
        return (path || '/')
            .replace(location.origin, '')
            .replace(/[#?].*$/, '')
            .replace(/^\//, '')
            .replace(/\/$/, '');
    }

    function sectionFromPath(path) {
        let s = cleanPath(path);
        return ROUTES[s] ? s : null;
    }

    function currentPageMatchesLocation() {
        return !CURRENT_PAGE.isHome &&
            cleanPath(CURRENT_PAGE.url) === cleanPath(location.pathname);
    }

    function sectionPageData(s) {
        return {
            type: 'section',
            key: s,
            title: s,
            kicker: 'anchorcell / ' + s,
            backUrl: '/',
            backLabel: 'Back',
            body: COPY[s] || '<p>More soon.</p>'
        };
    }

    function currentPageData() {
        let section = sectionFromPath(location.pathname);

        if (section) {
            return sectionPageData(section);
        }

        if (currentPageMatchesLocation()) {
            return {
                type: 'page',
                key: CURRENT_PAGE.url,
                title: CURRENT_PAGE.title || document.title.replace(/\s*\/.*$/, ''),
                kicker: CURRENT_PAGE.kicker || CURRENT_PAGE.title || 'anchorcell',
                backUrl: CURRENT_PAGE.backUrl || '/',
                backLabel: CURRENT_PAGE.backLabel || 'Back',
                body: CURRENT_PAGE.body || '<p>More soon.</p>'
            };
        }

        return null;
    }

    const SITE_TITLE = 'anchorcell';

    function setDocumentTitle(data) {
        const title = data && data.title
            ? String(data.title).trim()
            : '';

        if (!title || title.toLowerCase() === SITE_TITLE.toLowerCase()) {
            document.title = SITE_TITLE;
        } else {
            document.title = title + ' / ' + SITE_TITLE;
        }
    }

    function setHomeDocumentTitle() {
        document.title = SITE_TITLE;
    }

    function setPage(dataOrKey) {
        let data = typeof dataOrKey === 'string'
            ? sectionPageData(dataOrKey)
            : dataOrKey;

        if (!data) return;

        PAGE.page = data;
        PAGE.section = data.type === 'section' ? data.key : null;

        setDocumentTitle(data);

        pageTitle.textContent = (data.title || '').toLowerCase();
        pageKicker.textContent = data.kicker || 'anchorcell';
        pageBack.textContent = data.backLabel || 'Back';
        pageBack.dataset.backUrl = data.backUrl || '/';

        let c = data.body;
        pageBody.innerHTML = Array.isArray(c)
            ? c.map(x => '<p>' + x + '</p>').join('')
            : (c || '<p>More soon.</p>');
    }

    async function startPage(s, opts = {}) {
        if (PAGE.mode !== 'home' && !opts.force) return;

        let data;

        if (s === 'news') {
            try {
                data = await fetchRenderedPage(ROUTES.news);
            } catch (err) {
                if (!opts.noHistory) {
                    location.href = ROUTES.news;
                }
                return;
            }
        } else {
            if (!COPY[s]) return;
            data = sectionPageData(s);
        }

        if (!opts.noHistory) {
            history.pushState({ section: s }, '', ROUTES[s] || ('/' + s + '/'));
        }

        S.topEarth = true;
        PAGE.mode = 'in';
        PAGE.t0 = performance.now();

        setPage(data);

        siteOverlay.classList.add('faded');
        modeToggle.style.opacity = 0;
    }

    function closePage(opts = {}) {
        if (PAGE.mode !== 'page') return;

        let backUrl = (PAGE.page && PAGE.page.backUrl) || '/';

        // Posts should go back to /news/, not animate to homepage.
        if (backUrl !== '/' && !opts.noHistory) {
            location.href = backUrl;
            return;
        }

        // Section overlays still animate back to home.
        if (!opts.noHistory) {
            history.pushState({ section: 'home' }, '', '/');
        }

        setHomeDocumentTitle();

        PAGE.mode = 'out';
        PAGE.t0 = performance.now();
        pageOverlay.classList.remove('show');
    }

    function sectionFromLocation() {
        let h = location.hash.replace('#', '').replace(/^\//, '').replace(/\/$/, '');

        if (h && ROUTES[h]) {
            history.replaceState({ section: h }, '', ROUTES[h]);
            return h;
        }

        return sectionFromPath(location.pathname);
    }
    siteOverlay.querySelectorAll('nav a').forEach(a => a.onclick = e => { let url = new URL(a.href, location.origin), s = url.pathname.replace(/^\//, '').replace(/\/$/, ''); if (ROUTES[s]) { e.preventDefault(); startPage(s) } });
    pageBack.onclick = () => closePage();
    addEventListener('popstate', () => {
        let data = currentPageData();

        if (data) {
            PAGE.mode = 'page';
            setPage(data);
            pageOverlay.classList.add('show');
            siteOverlay.classList.add('faded');
            modeToggle.style.opacity = 0;
        } else if (PAGE.mode === 'page') {
            closePage({ noHistory: true });
        }
    });
    function fitZoom() { return START.zoom * (innerHeight / START.h) } function resize() { let dpr = Math.max(1, Math.min(1.5, devicePixelRatio || 1)); canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr); gl.viewport(0, 0, canvas.width, canvas.height); S.zoom = fitZoom() * dpr } addEventListener('resize', resize); resize(); let drag = null; function ambient(x, y) { let nx = (x / innerWidth - .5) * 2, ny = (y / innerHeight - .5) * 2; S.targetYaw = S.baseYaw + nx * .085; S.targetPitch = Math.max(-1.5, Math.min(1.5, S.basePitch - ny * .065)) } canvas.onpointerdown = e => { if (S.interactive) { drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch }; canvas.setPointerCapture(e.pointerId) } else ambient(e.clientX, e.clientY) }; canvas.onpointermove = e => { if (S.interactive && drag) { S.yaw = drag.yaw + (e.clientX - drag.x) * .008; S.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * .008)); S.baseYaw = S.yaw; S.basePitch = S.pitch } else if (!S.interactive && e.pointerType === 'mouse') ambient(e.clientX, e.clientY) }; addEventListener('pointermove', e => { if (!S.interactive && e.pointerType === 'mouse') ambient(e.clientX, e.clientY) }, { passive: true }); canvas.onpointerup = () => drag = null; canvas.onpointercancel = () => drag = null; canvas.onwheel = e => { if (!S.interactive) return; e.preventDefault(); S.zoom *= Math.exp(-e.deltaY * .001); S.zoom = Math.max(34, Math.min(260, S.zoom)) };
    function mday() { return S.ms / MSD } function day() { let d = new Date(S.ms); return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 36e5) / 24 } function yang() { let y = new Date(S.ms).getFullYear(), eq = new Date(y, 2, 20, 12).getTime(); return TAU * ((S.ms - eq) / MSD) / YR } function mang() { let e = Date.UTC(2000, 0, 6, 18, 14); return TAU * ((S.ms - e) / MSD / LM) } function sdec() { return P.obl * Math.sin(yang()) } function mdec() { let ma = mang(), node = TAU * ((mday() - 10957) / 6798); return P.obl * Math.sin(yang() + ma) + P.linc * Math.sin(ma - node) } function dz(d) { return P.declScale * d / P.obl } function sz(z) { return z + dz(sdec()) } function mz(z) { return z + dz(mdec()) }
    function push(A, p, c) { A.p.push(p.x, p.y, p.z); A.c.push(c[0], c[1], c[2], c[3]) } function line(A, a, b, c) { push(A, a, c); push(A, b, c) } function tri(A, a, b, c, col) { push(A, a, col); push(A, b, col); push(A, c, col) } function annulus(A, z, o, i, col, n = 300, a0 = 0, a1 = TAU) { for (let k = 0; k < n; k++) { let a = a0 + (a1 - a0) * k / n, b = a0 + (a1 - a0) * (k + 1) / n, p0 = c2w(v(o * Math.cos(a), o * Math.sin(a), z)), p1 = c2w(v(i * Math.cos(a), i * Math.sin(a), z)), p2 = c2w(v(o * Math.cos(b), o * Math.sin(b), z)), p3 = c2w(v(i * Math.cos(b), i * Math.sin(b), z)); tri(A, p0, p1, p2, col); tri(A, p2, p1, p3, col) } } function side(A, z0, z1, r, col, n = 180) { for (let k = 0; k < n; k++) { let a = k * TAU / n, b = (k + 1) * TAU / n, p0 = c2w(v(r * Math.cos(a), r * Math.sin(a), z0)), p1 = c2w(v(r * Math.cos(b), r * Math.sin(b), z0)), p2 = c2w(v(r * Math.cos(a), r * Math.sin(a), z1)), p3 = c2w(v(r * Math.cos(b), r * Math.sin(b), z1)); tri(A, p0, p1, p2, col); tri(A, p2, p1, p3, col) } } function ringOcc(A, z, o, i) { annulus(A, z - P.thick, o, i, C.b); annulus(A, z + P.thick, o, i, C.b); side(A, z - P.thick, z + P.thick, o, C.b); side(A, z - P.thick, z + P.thick, i, C.b) } function circlePts(z, r, n = 360, a0 = 0, a1 = TAU) { let pts = []; for (let k = 0; k < n; k++) { let a = a0 + (a1 - a0) * k / n; pts.push(c2w(v(r * Math.cos(a), r * Math.sin(a), z))) } return pts } function drawPath(pts, col, closed = true, px = 3.5) { if (pts.length < 2) return; let prev = [], curr = [], next = [], side = [], colors = []; let N = pts.length, seg = closed ? N : N - 1; for (let i = 0; i < seg; i++) { let i0 = i, i1 = (i + 1) % N, quad = [[i0, -1], [i0, 1], [i1, -1], [i1, -1], [i0, 1], [i1, 1]]; for (let [idx, s] of quad) { let p = pts[(idx - 1 + N) % N], c = pts[idx], n = pts[(idx + 1) % N]; if (!closed) { if (idx === 0) p = add(c, sub(c, n)); if (idx === N - 1) n = add(c, sub(c, p)) } prev.push(p.x, p.y, p.z); curr.push(c.x, c.y, c.z); next.push(n.x, n.y, n.z); side.push(s); colors.push(col[0], col[1], col[2], col[3]) } } gl.useProgram(pathProg); gl.uniformMatrix4fv(ploc.m, false, rotMat()); gl.uniform2f(ploc.res, canvas.width, canvas.height); gl.uniform1f(ploc.zoom, S.zoom * S.zm); gl.uniform1f(ploc.thick, px); function attr(buf, locn, data, n) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW); gl.vertexAttribPointer(locn, n, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(locn) } attr(pbuf, ploc.prev, prev, 3); attr(cbuf2, ploc.curr, curr, 3); attr(nbuf, ploc.next, next, 3); attr(sbuf, ploc.side, side, 1); attr(pcol, ploc.col, colors, 4); gl.drawArrays(gl.TRIANGLES, 0, curr.length / 3); gl.useProgram(prog) } function ringLines(z, o, i, col) { drawPath(circlePts(z - P.thick - .008, o, 420), col, true, 3.8); drawPath(circlePts(z - P.thick - .008, i, 420), col, true, 3.8); drawPath(circlePts(z + P.thick + .008, o, 420), C.w, true, 3.8); drawPath(circlePts(z + P.thick + .008, i, 420), C.w, true, 3.8) } function frontA(z, r) { let c = w2v(c2w(v(0, 0, z))), x = w2v(c2w(v(r, 0, z))), y = w2v(c2w(v(0, r, z))); return Math.atan2(y.z - c.z, x.z - c.z) } function screenBillboardTri(A, tip, prev, col, size = 13) { let q = w2v(tip), pq = w2v(prev), d = norm(v(q.x - pq.x, q.y - pq.y, 0)), n = v(-d.y, d.x, 0), s = size * (canvas.width / innerWidth) / S.zoom, bv = v(q.x - d.x * s, q.y - d.y * s, q.z), l = v(bv.x + n.x * s * .55, bv.y + n.y * s * .55, q.z), r = v(bv.x - n.x * s * .55, bv.y - n.y * s * .55, q.z); tri(A, invView(q), invView(l), invView(r), col) } function arrow(T, z, r, col) { let a = frontA(z, r) + Math.PI / 4, rr = r + .14, zz = z - P.arrowZ, tail = .45; drawPath(circlePts(zz, rr, 80, a + .22, a - tail), col, false, 3.2); let tip = c2w(v(rr * Math.cos(a - tail), rr * Math.sin(a - tail), zz)), prev = c2w(v(rr * Math.cos(a - tail + .035), rr * Math.sin(a - tail + .035), zz)); screenBillboardTri(T, tip, prev, col, 15) }
    function sphereOcc(A) {
        let R = P.starR * .993, lat = 18, lon = 40, lo = -Math.PI / 2 + P.bread, hi = Math.PI / 2 - P.bread;
        for (let i = 0; i < lat; i++) {
            let p0 = lo + i * (hi - lo) / lat, p1 = lo + (i + 1) * (hi - lo) / lat;
            for (let j = 0; j < lon; j++) {
                let a = j * TAU / lon, b = (j + 1) * TAU / lon, q00 = c2w(v(R * Math.cos(p0) * Math.cos(a), R * Math.cos(p0) * Math.sin(a), R * Math.sin(p0))), q01 = c2w(v(R * Math.cos(p0) * Math.cos(b), R * Math.cos(p0) * Math.sin(b), R * Math.sin(p0))), q10 = c2w(v(R * Math.cos(p1) * Math.cos(a), R * Math.cos(p1) * Math.sin(a), R * Math.sin(p1))), q11 = c2w(v(R * Math.cos(p1) * Math.cos(b), R * Math.cos(p1) * Math.sin(b), R * Math.sin(p1)));
                tri(A, q00, q10, q01, C.b); tri(A, q01, q10, q11, C.b)
            }
        }
    }
    function loopArrow(T, q) { let R = P.starR, rr = Math.sqrt(Math.max(0, R * R - q * q)), a = frontA(q, rr) + Math.PI / 4, tip = c2w(v(rr * Math.cos(a - .18), rr * Math.sin(a - .18), q)), prev = c2w(v(rr * Math.cos(a - .14), rr * Math.sin(a - .14), q)); screenBillboardTri(T, tip, prev, C.w, 11) } function cameraCelestialSide() { return w2v(c2w(v(0, 0, 1))).z - w2v(c2w(v(0, 0, 0))).z } function allStarQs() { let R = P.starR, lo = -Math.PI / 2 + P.bread, hi = Math.PI / 2 - P.bread, qs = []; for (let i = 0; i < 5; i++) { let phi = lo + (hi - lo) * i / 4; qs.push(R * Math.sin(phi)) } return qs } function visibleStarQs() { let qs = allStarQs(), side = cameraCelestialSide(); if (side > .32) qs = qs.slice(1); else if (side < -.32) qs = qs.slice(0, 4); return qs } function starLoops(T, heads = true) { let R = P.starR; for (let q of visibleStarQs()) { let rr = Math.sqrt(Math.max(0, R * R - q * q)); drawPath(circlePts(q, rr, 420), C.w, true, 2.8); if (heads) loopArrow(T, q) } } function starLoopHeads(T) { let R = P.starR; for (let q of visibleStarQs()) loopArrow(T, q) } function starDots(Pts) { let R = P.starR; for (let k = 0; k < 96; k += 2) { let a = k * TAU / 96; push(Pts, invView(v(R * Math.cos(a), R * Math.sin(a), 0)), C.w) } }
    function earthTargetRadius() {
        const dpr = canvas.width / innerWidth;
        const scale = (S.earthScale || 1) * (P.rayTargetScale || 1);

        return Math.max(1, P.earthR * scale * S.zoom * S.zm / dpr);
    }
    function rayScreenInfo(kind) { let sun = kind === 'sun', inner = sun ? P.sunInner : P.moonInner, outer = sun ? P.sunOuter : P.moonOuter, z = sun ? sz(0) : mz(0), col = sun ? C.s : C.m, ideal = sun ? P.sunAng : P.moonAng, shift = -(day() * TAU + (sun ? 0 : mang())), a = ideal + shift, src = c2w(v(inner * Math.cos(a), inner * Math.sin(a), z)), outerPt = c2w(v(outer * Math.cos(a), outer * Math.sin(a), z)), centre = projectW(c2w(v(0, 0, z))), earthScreen = projectW(v(0, 0, 0)), srcScreen = projectW(src), outerScreen = projectW(outerPt), base = Math.atan2(srcScreen.y - earthScreen.y, srcScreen.x - earthScreen.x); return { sun, src, earthScreen, srcScreen, outerScreen, centre, base, col } } function screenToWorldAtEarthDepth(sx, sy) { let dpr = canvas.width / innerWidth, ez = w2v(v(0, 0, 0)).z; return invView(v((sx - innerWidth / 2) * dpr / (S.zoom * S.zm), (innerHeight / 2 - sy) * dpr / (S.zoom * S.zm), ez)) } function circularMean(a, b) { return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b)) } function earthLabelScreen() { let s = rayScreenInfo('sun'), m = rayScreenInfo('moon'), r = earthTargetRadius(), away = circularMean(s.base, m.base) + Math.PI; return { x: s.earthScreen.x + Math.cos(away) * (r + 20), y: s.earthScreen.y + Math.sin(away) * (r + 20), z: s.earthScreen.z } } function bodyLabelScreen(kind) { let info = rayScreenInfo(kind), dx = info.outerScreen.x - info.centre.x, dy = info.outerScreen.y - info.centre.y, l = Math.hypot(dx, dy) || 1; return { x: info.outerScreen.x + dx / l * 48, y: info.outerScreen.y + dy / l * 48, z: info.outerScreen.z } } function starsLabelScreen() { let p = projectW(invView(v(0, P.starR, 0))); return { x: p.x, y: p.y - 22, z: p.z } } function rays(A) { let targetR = earthTargetRadius(), count = 5; for (let kind of ['sun', 'moon']) { let info = rayScreenInfo(kind), spread = (info.sun ? 62 : 84) * Math.PI / 180; for (let j = 0; j < count; j++) { let u = count === 1 ? .5 : j / (count - 1), ang = info.base + (-.5 + u) * spread, tx = info.earthScreen.x + Math.cos(ang) * targetR, ty = info.earthScreen.y + Math.sin(ang) * targetR, dst = screenToWorldAtEarthDepth(tx, ty); line(A, info.src, dst, info.col) } } } function axis(A) { line(A, c2w(v(0, 0, -5.5)), c2w(v(0, 0, 5.5)), C.w) } function earth(A, scale = 1) { let n = 72, r = P.earthR * scale, h = P.earthH * scale; for (let k = 0; k < n; k++) { let a = k * TAU / n, b = (k + 1) * TAU / n, p0 = v(r * Math.cos(a), -h, r * Math.sin(a)), p1 = v(r * Math.cos(b), -h, r * Math.sin(b)), p2 = v(r * Math.cos(a), h, r * Math.sin(a)), p3 = v(r * Math.cos(b), h, r * Math.sin(b)); tri(A, p0, p1, p2, C.w); tri(A, p2, p1, p3, C.w); tri(A, v(0, h, 0), p2, p3, C.w); tri(A, v(0, -h, 0), p1, p0, C.w) } } function drawBatch(mode, A, pt = 3.5) { if (!A.p.length) return; gl.uniform1f(loc.point, pt); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(A.p), gl.STREAM_DRAW); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(loc.pos); gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(A.c), gl.STREAM_DRAW); gl.vertexAttribPointer(loc.col, 4, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(loc.col); gl.drawArrays(mode, 0, A.p.length / 3) }
    function drawScene(earthScale = 1, topEarth = false, zoomMul = 1, white = false) { S.zm = zoomMul;
        gl.useProgram(prog);
        gl.uniformMatrix4fv(loc.m, false, rotMat());
        gl.uniform2f(loc.res, canvas.width, canvas.height);
        gl.uniform1f(loc.zoom, S.zoom * zoomMul);
        gl.clearColor(white ? 1 : 0, white ? 1 : 0, white ? 1 : 0, 1);
        gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (white) return;
        let sphere = { p: [], c: [] }, ring = { p: [], c: [] }, L1 = { p: [], c: [] }, T1 = { p: [], c: [] };
        sphereOcc(sphere);
        drawBatch(gl.TRIANGLES, sphere);
        starLoops(T1, false);
        drawPath([c2w(v(0, 0, -5.5)), c2w(v(0, 0, 5.5))], C.w, false, 3.8);
        ringOcc(ring, sz(0), P.sunOuter, P.sunInner);
        ringOcc(ring, mz(0), P.moonOuter, P.moonInner);
        drawBatch(gl.TRIANGLES, ring);
        ringLines(sz(0), P.sunOuter, P.sunInner, C.s);
        ringLines(mz(0), P.moonOuter, P.moonInner, C.m);
        arrow(T1, sz(0), P.sunOuter, C.s);
        arrow(T1, mz(0), P.moonOuter, C.m);
        drawBatch(gl.TRIANGLES, T1);
        drawBatch(gl.LINES, L1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        let ringDepth = { p: [], c: [] };
        ringOcc(ringDepth, sz(0), P.sunOuter, P.sunInner);
        ringOcc(ringDepth, mz(0), P.moonOuter, P.moonInner);
        gl.colorMask(false, false, false, false);
        drawBatch(gl.TRIANGLES, ringDepth);
        gl.colorMask(true, true, true, true);
        let L2 = { p: [], c: [] }, T2 = { p: [], c: [] }, Pts = { p: [], c: [] };
        rays(L2);
        starLoopHeads(T2);
        drawBatch(gl.TRIANGLES, T2);
        drawBatch(gl.LINES, L2);
        starDots(Pts);
        drawBatch(gl.POINTS, Pts, 3.8);
        let E = { p: [], c: [] };
        earth(E, earthScale);
        if (topEarth) gl.clear(gl.DEPTH_BUFFER_BIT);
        drawBatch(gl.TRIANGLES, E)
    }
    
    function ease(t) { t = Math.max(0, Math.min(1, t)); return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 }
    function progress(now) { return Math.max(0, Math.min(1, (now - PAGE.t0) / PAGE.duration)) }
    function setLabel(el, p) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px' }
    function updateLabels() { let d = { sun: bodyLabelScreen('sun'), moon: bodyLabelScreen('moon'), earth: earthLabelScreen(), stars: starsLabelScreen(), N: projectW(c2w(v(0, 0, 5.65))), S: projectW(c2w(v(0, 0, -5.65))) }; for (let k in d) setLabel(labels[k], d[k]); for (let k in labels) labels[k].classList.toggle('hidden', PAGE.mode !== 'home') }
    function readouts() { let sd = sdec(), md = mdec(), ma = ((mang() / TAU) % 1 + 1) % 1, phase = ma < .03 || ma > .97 ? 'new' : ma < .47 ? 'waxing' : ma < .53 ? 'full' : 'waning'; $('datev').textContent = new Date(S.ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); $('speedv').textContent = S.speed.toFixed(0) + '×'; $('sunReadout').textContent = 'sun declination ' + sd.toFixed(1) + '°'; $('moonReadout').textContent = 'moon declination ' + md.toFixed(1) + '° / ' + phase }
    function frame() {
        let now = performance.now(), dt = (now - S.last) / 1000;
        S.last = now;
        if (!S.interactive) {
            let k = 1 - Math.exp(-dt * 5.5);
            S.yaw += (S.targetYaw - S.yaw) * k;
            S.pitch += (S.targetPitch - S.pitch) * k
        }
        if (S.play) {
            S.ms += dt * 1000 * S.speed;
            if (now - S.readoutLast > 500 && document.activeElement !== dateTime) dateTime.value = toInput(S.ms);
        }
        if (now - S.readoutLast > 500) {
            readouts();
            S.readoutLast = now;
        }
        if (PAGE.mode === 'home') {
            drawScene(1, S.topEarth, 1, false);
            updateLabels();
        } else if (PAGE.mode === 'in') {
            let p = progress(now), e = ease(p), filled = p > .56;
            drawScene(1 + e * 170, true, 1 + e * 8, filled);
            updateLabels();
            if (p > .58) {
                pageOverlay.classList.add('show');
            }
            if (p >= .82) {
                PAGE.mode = 'page';
                pageOverlay.classList.add('show');
            }
        } else if (PAGE.mode === 'page') { 
            drawScene(1, true, 8, true);
        } else if (PAGE.mode === 'out') {
            let p = progress(now), e = ease(1 - p);
            drawScene(1 + e * 170, true, 1 + e * 8, p < .16);
            if (p >= 1) {
                S.topEarth = false;
                PAGE.mode = 'home';
                siteOverlay.classList.remove('faded');
                modeToggle.style.opacity = 1;
                pageOverlay.classList.remove('show')
            }
        }
        requestAnimationFrame(frame)
    }

    let initialData = currentPageData();

    if (initialData) {
        PAGE.mode = 'page';
        S.topEarth = true;
        setPage(initialData);
        pageOverlay.classList.add('show');
        siteOverlay.classList.add('faded');
        modeToggle.style.opacity = 0;
    }

    requestAnimationFrame(frame);
})();
