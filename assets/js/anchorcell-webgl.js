(() => {
  if (globalThis.__ANCHORCELL_WEBGL_STARTED__) return;
  globalThis.__ANCHORCELL_WEBGL_STARTED__ = true;

  const canvas = document.getElementById("gl");

  if (!canvas) {
    document.documentElement.classList.add("no-webgl");
    globalThis.__ANCHORCELL_WEBGL_STARTED__ = false;
    return;
  }

  function createWebGLContext(canvas) {
    const contextNames = ["webgl", "experimental-webgl"];

    const optionSets = [
      { antialias: true, alpha: false },
      { antialias: false, alpha: false },
      { antialias: true, alpha: true },
      { antialias: false, alpha: true },
      {},
    ];

    for (const contextName of contextNames) {
      for (const contextOptions of optionSets) {
        try {
          const context = canvas.getContext(contextName, contextOptions);

          if (context) {
            return context;
          }
        } catch {
          // Try the next option set.
        }
      }
    }

    return null;
  }

  const gl = createWebGLContext(canvas);

  if (!gl) {
    document.documentElement.classList.remove("webgl-ready");
    document.documentElement.classList.add("no-webgl");
    globalThis.__ANCHORCELL_WEBGL_STARTED__ = false;
    return;
  }

  const FULL_TURN_RADIANS = Math.PI * 2,
    MILLISECONDS_PER_DAY = 86400000,
    DAYS_PER_TROPICAL_YEAR = 365.2422,
    LUNAR_MONTH_DAYS = 29.530588853,
    palette = {
      white: [1, 1, 1, 1],
      sun: [.918, .878, .639, 1],
      moon: [.651, .761, .937, 1],
      black: [0, 0, 0, 1],
    };
  const renderParams = {
    starRadius: 1.5,
    latitudeMargin: 25 * Math.PI / 180,
    sunOuterRadius: 4.45,
    sunInnerRadius: 4.05,
    moonOuterRadius: 2.76,
    moonInnerRadius: 2.36,
    lineThickness: .04,
    arrowDepthOffset: .12,
    basisAzimuth: -40 * Math.PI / 180,
    basisInclination: -52.5 * Math.PI / 180,
    axialTiltDegrees: 23.44,
    lunarInclinationDegrees: 5.14,
    declinationScale: 1.38,
    sunAngle: 300 * Math.PI / 180,
    moonAngle: 60 * Math.PI / 180,
    earthRadius: .15,
    earthHalfHeight: .025,
    rayTargetScale: 2,
  };
  const initialView = {
    yaw: -Math.PI / 4 + 2.2,
    pitch: Math.atan(1 / Math.sqrt(2)) - 0.25,
    zoom: 123.75757575757575,
    referenceHeight: 1021,
  };
  const sceneState = {
    yaw: initialView.yaw,
    pitch: initialView.pitch,
    zoom: initialView.zoom,
    isPlaying: true,
    timeMs: Date.now(),
    timeScale: 1,
    previousFrameTime: performance.now(),
    isInteractive: false,
    baseYaw: initialView.yaw,
    basePitch: initialView.pitch,
    targetYaw: initialView.yaw,
    targetPitch: initialView.pitch,
    lastReadoutAt: 0,
    earthOnTop: false,
    zoomMultiplier: 1,
  };

  let frameRequestId = 0;
  let renderingEnabled = true;
  let contextLost = false;
  const getElement = (id) => document.getElementById(id),
    dateTimeInput = getElement("dateTime"),
    speedInput = getElement("speed"),
    uiPanel = getElement("uiPanel"),
    modeToggle = getElement("modeToggle"),
    siteOverlay = document.querySelector(".siteOverlay"),
    pageOverlay = getElement("pageOverlay"),
    pageBack = getElement("pageBack"),
    pageTitle = getElement("pageTitle"),
    pageBody = getElement("pageBody"),
    pageKicker = getElement("pageKicker"),
    labels = {
      sun: getElement("sunLabel"),
      moon: getElement("moonLabel"),
      earth: getElement("earthLabel"),
      stars: getElement("starsLabel"),
      N: getElement("nLabel"),
      S: getElement("sLabel"),
    };

  function exposeStaticFallback() {
    renderingEnabled = false;
    if (frameRequestId) cancelAnimationFrame(frameRequestId);
    document.documentElement.classList.remove("webgl-ready");
    document.documentElement.classList.add("no-webgl");
    globalThis.__ANCHORCELL_WEBGL_STARTED__ = false;
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    exposeStaticFallback();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    if (contextLost) location.reload();
  });
  const sceneVertexShader =
    `attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uM;uniform vec2 uRes;uniform float uZoom;uniform float uPoint;varying vec4 vCol;void main(){vec4 q=uM*vec4(aPos,1.);vec2 clip=vec2(q.x*uZoom/(uRes.x*.5),q.y*uZoom/(uRes.y*.5));gl_Position=vec4(clip,-q.z/96.,1.);gl_PointSize=uPoint;vCol=aCol;}`;
  const fragmentShader =
    `precision mediump float;varying vec4 vCol;void main(){gl_FragColor=vCol;}`;
  function createShader(shaderType, source) {
    const shader = gl.createShader(shaderType);
    if (!shader) throw Error("Could not create WebGL shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    let vertexShader = null;
    let fragmentShader = null;
    let program = null;
    let linked = false;

    try {
      vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
      fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();

      if (!program) throw Error("Could not create WebGL program");

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      linked = gl.getProgramParameter(program, gl.LINK_STATUS);

      if (!linked) {
        throw Error(
          gl.getProgramInfoLog(program) || "Could not link WebGL program",
        );
      }

      return program;
    } finally {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      if (!linked && program) gl.deleteProgram(program);
    }
  }

  let sceneProgram;
  let pathProgram;
  let sceneLocations;
  let pathLocations;
  let positionBuffer;
  let colorBuffer;
  let previousPathBuffer;
  let currentPathBuffer;
  let nextPathBuffer;
  let pathSideBuffer;
  let pathColorBuffer;

  try {
    sceneProgram = createProgram(sceneVertexShader, fragmentShader);
    sceneLocations = {
      position: gl.getAttribLocation(sceneProgram, "aPos"),
      color: gl.getAttribLocation(sceneProgram, "aCol"),
      modelMatrix: gl.getUniformLocation(sceneProgram, "uM"),
      resolution: gl.getUniformLocation(sceneProgram, "uRes"),
      zoom: gl.getUniformLocation(sceneProgram, "uZoom"),
      pointSize: gl.getUniformLocation(sceneProgram, "uPoint"),
    },
      positionBuffer = gl.createBuffer(),
      colorBuffer = gl.createBuffer();
    const pathVertexShader =
      `attribute vec3 aPrev;attribute vec3 aCurr;attribute vec3 aNext;attribute float aSide;attribute vec4 aCol;uniform mat4 uM;uniform vec2 uRes;uniform float uZoom;uniform float uThickness;varying vec4 vCol;vec4 project(vec3 p){vec4 q=uM*vec4(p,1.);return vec4(q.x*uZoom/(uRes.x*.5),q.y*uZoom/(uRes.y*.5),-q.z/96.,1.);}void main(){vec4 pp=project(aPrev),cc=project(aCurr),nn=project(aNext);float aspect=uRes.x/uRes.y;vec2 p=pp.xy*vec2(aspect,1.),c=cc.xy*vec2(aspect,1.),n=nn.xy*vec2(aspect,1.);vec2 d0=normalize(c-p),d1=normalize(n-c);vec2 tangent=normalize(d0+d1);if(length(tangent)<.01)tangent=d1;vec2 miter=vec2(-tangent.y,tangent.x);vec2 normal=vec2(-d1.y,d1.x);float denom=max(.25,abs(dot(miter,normal)));float len=(uThickness/uRes.y)/denom;vec2 off=miter*aSide*len;off.x/=aspect;gl_Position=cc;gl_Position.xy+=off;vCol=aCol;}`;
    pathProgram = createProgram(pathVertexShader, fragmentShader);
    pathLocations = {
      previous: gl.getAttribLocation(pathProgram, "aPrev"),
      current: gl.getAttribLocation(pathProgram, "aCurr"),
      next: gl.getAttribLocation(pathProgram, "aNext"),
      side: gl.getAttribLocation(pathProgram, "aSide"),
      color: gl.getAttribLocation(pathProgram, "aCol"),
      modelMatrix: gl.getUniformLocation(pathProgram, "uM"),
      resolution: gl.getUniformLocation(pathProgram, "uRes"),
      zoom: gl.getUniformLocation(pathProgram, "uZoom"),
      thickness: gl.getUniformLocation(pathProgram, "uThickness"),
    },
      previousPathBuffer = gl.createBuffer(),
      currentPathBuffer = gl.createBuffer(),
      nextPathBuffer = gl.createBuffer(),
      pathSideBuffer = gl.createBuffer(),
      pathColorBuffer = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    try {
      gl.lineWidth(3);
    } catch {
      // Some contexts ignore line width changes.
    }
  } catch (error) {
    console.error("WebGL initialization failed:", error);
    exposeStaticFallback();
    return;
  }
  function vec3(x = 0, y = 0, z = 0) {
    return { x, y, z };
  }
  function addVec3(first, second) {
    return vec3(
      first.x + second.x,
      first.y + second.y,
      first.z + second.z,
    );
  }
  function subtractVec3(minuend, subtrahend) {
    return vec3(
      minuend.x - subtrahend.x,
      minuend.y - subtrahend.y,
      minuend.z - subtrahend.z,
    );
  }
  function scaleVec3(vector, scalar) {
    return vec3(vector.x * scalar, vector.y * scalar, vector.z * scalar);
  }
  function normalizeVec3(vector) {
    const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
    return scaleVec3(vector, 1 / length);
  }
  function celestialBasis() {
    const azimuth = renderParams.basisAzimuth;
    const inclination = renderParams.basisInclination;

    return {
      axis: vec3(
        Math.sin(inclination) * Math.cos(azimuth),
        Math.sin(inclination) * Math.sin(azimuth),
        Math.cos(inclination),
      ),
      xAxis: vec3(
        Math.cos(azimuth) * Math.cos(inclination),
        Math.sin(azimuth) * Math.cos(inclination),
        -Math.sin(inclination),
      ),
      yAxis: vec3(-Math.sin(azimuth), Math.cos(azimuth), 0),
    };
  }
  function celestialToWorld(celestialPoint) {
    const basis = celestialBasis();

    return addVec3(
      addVec3(
        scaleVec3(basis.xAxis, celestialPoint.x),
        scaleVec3(basis.yAxis, celestialPoint.y),
      ),
      scaleVec3(basis.axis, celestialPoint.z),
    );
  }
  function rotationMatrix() {
    const cosYaw = Math.cos(sceneState.yaw);
    const sinYaw = Math.sin(sceneState.yaw);
    const cosPitch = Math.cos(sceneState.pitch);
    const sinPitch = Math.sin(sceneState.pitch);

    return new Float32Array([
      cosYaw,
      sinPitch * sinYaw,
      -cosPitch * sinYaw,
      0,
      0,
      cosPitch,
      sinPitch,
      0,
      sinYaw,
      -sinPitch * cosYaw,
      cosPitch * cosYaw,
      0,
      0,
      0,
      0,
      1,
    ]);
  }
  function worldToView(worldPoint) {
    const cosYaw = Math.cos(sceneState.yaw);
    const sinYaw = Math.sin(sceneState.yaw);
    const viewX = cosYaw * worldPoint.x + sinYaw * worldPoint.z;
    const rotatedZ = -sinYaw * worldPoint.x + cosYaw * worldPoint.z;
    const cosPitch = Math.cos(sceneState.pitch);
    const sinPitch = Math.sin(sceneState.pitch);
    const viewY = worldPoint.y;

    return {
      x: viewX,
      y: cosPitch * viewY - sinPitch * rotatedZ,
      z: sinPitch * viewY + cosPitch * rotatedZ,
    };
  }
  function viewToWorld(viewPoint) {
    const cosPitch = Math.cos(sceneState.pitch);
    const sinPitch = Math.sin(sceneState.pitch);
    const cosYaw = Math.cos(sceneState.yaw);
    const sinYaw = Math.sin(sceneState.yaw);
    const worldY = cosPitch * viewPoint.y + sinPitch * viewPoint.z;
    const rotatedZ = -sinPitch * viewPoint.y + cosPitch * viewPoint.z;
    const worldX = viewPoint.x;

    return vec3(
      cosYaw * worldX - sinYaw * rotatedZ,
      worldY,
      sinYaw * worldX + cosYaw * rotatedZ,
    );
  }
  function projectWorldToScreen(worldPoint) {
    const viewPoint = worldToView(worldPoint);
    const devicePixelRatio = canvas.width / innerWidth;

    return {
      x: innerWidth / 2 + viewPoint.x * sceneState.zoom / devicePixelRatio,
      y: innerHeight / 2 - viewPoint.y * sceneState.zoom / devicePixelRatio,
      z: viewPoint.z,
    };
  }
  function padTwoDigits(value) {
    return String(value).padStart(2, "0");
  }
  function formatDateTimeInput(timeMs) {
    const date = new Date(timeMs);
    return date.getFullYear() + "-" +
      padTwoDigits(date.getMonth() + 1) + "-" +
      padTwoDigits(date.getDate()) + "T" +
      padTwoDigits(date.getHours()) + ":" +
      padTwoDigits(date.getMinutes());
  }
  function parseDateTimeInput(inputValue) {
    const timestamp = new Date(inputValue).getTime();
    return Number.isFinite(timestamp) ? timestamp : sceneState.timeMs;
  }
  dateTimeInput.value = formatDateTimeInput(sceneState.timeMs);
  getElement("play").onclick = () => {
    sceneState.isPlaying = !sceneState.isPlaying;
    getElement("play").textContent = sceneState.isPlaying ? "pause" : "resume";
  };
  getElement("reset").onclick = () => {
    sceneState.yaw = sceneState.baseYaw = sceneState.targetYaw = initialView
      .yaw;
    sceneState.pitch =
      sceneState.basePitch =
      sceneState.targetPitch =
        initialView.pitch;
    sceneState.zoom = fitViewportZoom() * (canvas.width / innerWidth);
  };
  getElement("now").onclick = () => {
    sceneState.timeMs = Date.now();
    dateTimeInput.value = formatDateTimeInput(sceneState.timeMs);
  };
  function commitDateTimeInput() {
    sceneState.timeMs = parseDateTimeInput(dateTimeInput.value);
    dateTimeInput.value = formatDateTimeInput(sceneState.timeMs);
    updateReadouts();
  }
  dateTimeInput.oninput = () => {
    let t = new Date(dateTimeInput.value).getTime();
    if (Number.isFinite(t)) sceneState.timeMs = t;
  };
  dateTimeInput.onchange = commitDateTimeInput;
  dateTimeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDateTimeInput();
      dateTimeInput.blur();
    }
  });
  speedInput.oninput = () => sceneState.timeScale = +speedInput.value;

  const navigation = globalThis.ANCHORCELL_NAVIGATION || {},
    initialPageData = globalThis.ANCHORCELL_PAGE || {},
    sectionManifest = navigation.sections || [],
    routeTable = Object.fromEntries(
      sectionManifest.map(({ key, url }) => [key, url]),
    ),
    homeRoute = navigation.home || "/",
    sectionRoutes = sectionManifest.map(({ key, url }) => [key, url]),
    pageTransition = {
      phase: "home",
      pageData: null,
      startedAtMs: 0,
      durationMs: 950,
      returnFocusElement: null,
    };

  const navigationState = {
    sequence: 0,
    controller: null,
  };

  function beginNavigation() {
    navigationState.controller?.abort();
    const request = {
      id: ++navigationState.sequence,
      controller: new AbortController(),
    };
    navigationState.controller = request.controller;
    return request;
  }

  function isCurrentNavigation(request) {
    return navigationState.sequence === request.id &&
      navigationState.controller === request.controller;
  }

  function finishNavigation(request) {
    if (isCurrentNavigation(request)) navigationState.controller = null;
  }

  function cancelNavigation() {
    navigationState.sequence++;
    navigationState.controller?.abort();
    navigationState.controller = null;
  }

  function setPageOverlayVisible(visible, { focus = true } = {}) {
    const wasVisible = pageOverlay.classList.contains("show");
    pageOverlay.classList.toggle("show", visible);
    pageOverlay.setAttribute("aria-hidden", String(!visible));
    pageOverlay.inert = !visible;

    if (visible && !wasVisible && focus) {
      pageBack.focus({ preventScroll: true });
    } else if (!visible && pageOverlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function setSiteOverlayVisible(visible) {
    siteOverlay.classList.toggle("faded", !visible);
    siteOverlay.setAttribute("aria-hidden", String(!visible));
    siteOverlay.inert = !visible;
  }

  function setModeToggleVisible(visible) {
    modeToggle.style.opacity = visible ? "1" : "0";
    modeToggle.style.pointerEvents = visible ? "auto" : "none";
    modeToggle.setAttribute("aria-hidden", String(!visible));
    modeToggle.tabIndex = visible ? 0 : -1;
    modeToggle.inert = !visible;
  }

  function setInteractionPanelVisible(visible) {
    uiPanel.classList.toggle("show", visible);
    uiPanel.setAttribute("aria-hidden", String(!visible));
    uiPanel.inert = !visible;
    modeToggle.setAttribute("aria-expanded", String(visible));
    modeToggle.setAttribute(
      "aria-label",
      visible ? "Leave interaction mode" : "Enter interaction mode",
    );
  }

  function restorePageFocus() {
    const target = pageTransition.returnFocusElement ||
      siteOverlay.querySelector(".bandTitle");
    pageTransition.returnFocusElement = null;

    if (target instanceof HTMLElement && document.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  function returnHome() {
    sceneState.earthOnTop = false;
    pageTransition.phase = "home";
    pageTransition.pageData = null;
    setHomeDocumentTitle();
    setSiteOverlayVisible(true);
    setModeToggleVisible(true);
    setPageOverlayVisible(false);
    restorePageFocus();
  }

  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function trapPageTab(e) {
    if (e.key !== "Tab" || pageOverlay.inert) return;

    const focusable = [...pageOverlay.querySelectorAll(focusableSelector)]
      .filter((el) => el.getClientRects().length);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  setInteractionPanelVisible(false);
  setModeToggleVisible(true);
  setSiteOverlayVisible(true);

  modeToggle.onclick = () => {
    sceneState.isInteractive = !sceneState.isInteractive;
    setInteractionPanelVisible(sceneState.isInteractive);
    setSiteOverlayVisible(!sceneState.isInteractive);
    modeToggle.textContent = sceneState.isInteractive ? "shun" : "interact";
    dragState = null;
    sceneState.baseYaw = sceneState.yaw;
    sceneState.basePitch = sceneState.pitch;
    sceneState.targetYaw = sceneState.yaw;
    sceneState.targetPitch = sceneState.pitch;
  };

  async function fetchRenderedPage(url, signal) {
    const res = await fetch(url, { signal });

    if (!res.ok) {
      throw new Error("Could not load " + url);
    }

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const root = doc.querySelector(".staticFallbackPage") || doc;
    const title = root.querySelector(".pageTitle");
    const kicker = root.querySelector("#pageKicker, .pageKicker");
    const body = root.querySelector(".pageBody");
    const back = root.querySelector(".pageBack");

    if (!body) {
      throw new Error("No page body found in " + url);
    }

    return {
      type: "fetched",
      key: url,
      title: title ? title.textContent.trim() : "news",
      kicker: kicker ? kicker.textContent.trim() : "anchorcell / news",
      backUrl: back ? back.getAttribute("href") || homeRoute : homeRoute,
      backLabel: back ? back.textContent.trim() || "go back" : "go back",
      body: body.innerHTML,
    };
  }

  function normalizePathname(candidatePath) {
    return new URL(candidatePath || homeRoute, location.href).pathname
      .replace(/\/+$/, "") || "/";
  }

  function sectionKeyForPath(candidatePath) {
    const targetPath = normalizePathname(candidatePath);
    return sectionRoutes.find(([, route]) =>
      normalizePathname(route) === targetPath
    )
      ?.[0] ||
      null;
  }

  function currentPageMatchesLocation() {
    return !initialPageData.isHome &&
      normalizePathname(initialPageData.url) ===
        normalizePathname(location.pathname);
  }

  function pageDataForSection(sectionKey) {
    const section = sectionManifest.find(({ key }) => key === sectionKey);
    if (!section) return null;

    return {
      type: "section",
      key: section.key,
      title: section.label,
      kicker: "anchorcell / " + section.label,
      backUrl: homeRoute,
      backLabel: "go back",
      body: section.html || "<p>More soon.</p>",
    };
  }

  function pageDataForLocation() {
    const sectionKey = sectionKeyForPath(location.pathname);

    if (sectionKey) {
      return pageDataForSection(sectionKey);
    }

    if (currentPageMatchesLocation()) {
      return {
        type: "page",
        key: initialPageData.url,
        title: initialPageData.title ||
          document.title.replace(/\s*\/.*$/, ""),
        kicker: initialPageData.kicker || initialPageData.title || "anchorcell",
        backUrl: initialPageData.backUrl || homeRoute,
        backLabel: initialPageData.backLabel || "go back",
        body: initialPageData.body || "<p>More soon.</p>",
      };
    }

    return null;
  }

  const SITE_TITLE = "anchorcell";

  function setDocumentTitle(data) {
    const title = data && data.title ? String(data.title).trim() : "";

    if (!title || title.toLowerCase() === SITE_TITLE.toLowerCase()) {
      document.title = SITE_TITLE;
    } else {
      document.title = title + " / " + SITE_TITLE;
    }
  }

  function setHomeDocumentTitle() {
    document.title = SITE_TITLE;
  }

  function setPage(pageDataOrKey) {
    const pageData = typeof pageDataOrKey === "string"
      ? pageDataForSection(pageDataOrKey)
      : pageDataOrKey;

    if (!pageData) return;

    pageTransition.pageData = pageData;

    setDocumentTitle(pageData);

    pageTitle.textContent = (pageData.title || "").toLowerCase();
    pageKicker.textContent = pageData.kicker || "anchorcell";
    pageBack.textContent = String(pageData.backLabel || "go back")
      .toLowerCase();
    pageBack.dataset.backUrl = pageData.backUrl || homeRoute;

    const content = pageData.body;
    pageBody.innerHTML = Array.isArray(content)
      ? content.map((x) => "<p>" + x + "</p>").join("")
      : (content || "<p>More soon.</p>");
  }

  async function openSectionPage(sectionKey, options = {}) {
    if (pageTransition.phase !== "home" && !options.force) return;

    const route = routeTable[sectionKey];
    if (!route) return;
    if (
      sectionKey !== "news" &&
      !sectionManifest.some(({ key }) => key === sectionKey)
    ) return;

    if (options.force) cancelNavigation();
    const request = beginNavigation();

    if (!options.noHistory) {
      const activeElement = document.activeElement;
      pageTransition.returnFocusElement = siteOverlay.contains(activeElement)
        ? activeElement
        : null;
      history.pushState({ section: sectionKey }, "", route);
    }

    pageTransition.pageData = null;
    pageTransition.phase = "loading";
    setSiteOverlayVisible(false);
    setModeToggleVisible(false);

    let pageData;

    if (sectionKey === "news") {
      try {
        pageData = await fetchRenderedPage(
          route,
          request.controller.signal,
        );
      } catch (error) {
        if (!isCurrentNavigation(request)) return;
        finishNavigation(request);

        if (error?.name === "AbortError") return;
        if (!options.noHistory) {
          location.href = route;
        } else {
          returnHome();
        }
        return;
      }
    } else {
      pageData = pageDataForSection(sectionKey);
    }

    if (!isCurrentNavigation(request)) return;
    if (
      !options.noHistory &&
      normalizePathname(location.pathname) !== normalizePathname(route)
    ) {
      cancelNavigation();
      return;
    }

    finishNavigation(request);
    sceneState.earthOnTop = true;
    pageTransition.phase = "entering";
    pageTransition.startedAtMs = performance.now();
    setPage(pageData);
  }

  function closePageOverlay(options = {}) {
    const phase = pageTransition.phase;

    if (phase === "loading" || phase === "entering") {
      cancelNavigation();
      if (!options.noHistory) {
        history.pushState({ section: "home" }, "", homeRoute);
      }
      returnHome();
      return;
    }

    if (phase !== "open") return;

    const backUrl =
      (pageTransition.pageData && pageTransition.pageData.backUrl) ||
      homeRoute;

    // Posts should go back to /news/, not animate to homepage.
    if (backUrl !== homeRoute && !options.noHistory) {
      location.href = backUrl;
      return;
    }

    // Section overlays still animate back to home.
    if (!options.noHistory) {
      history.pushState({ section: "home" }, "", homeRoute);
    }

    setHomeDocumentTitle();

    pageTransition.phase = "leaving";
    pageTransition.startedAtMs = performance.now();
    setPageOverlayVisible(false);
  }

  siteOverlay.querySelectorAll("nav a").forEach((link) =>
    link.onclick = (event) => {
      const sectionKey = sectionKeyForPath(link.href);
      const isPrimaryClick = event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        pageTransition.phase === "home";

      if (sectionKey && isPrimaryClick) {
        event.preventDefault();
        openSectionPage(sectionKey);
      }
    }
  );
  pageBack.onclick = () => closePageOverlay();
  pageOverlay.addEventListener("keydown", trapPageTab);
  addEventListener("popstate", () => {
    cancelNavigation();
    const pageData = pageDataForLocation();

    if (pageData) {
      sceneState.earthOnTop = true;
      pageTransition.phase = "open";
      setPage(pageData);
      setPageOverlayVisible(true);
      setSiteOverlayVisible(false);
      setModeToggleVisible(false);
    } else if (pageTransition.phase === "open") {
      closePageOverlay({ noHistory: true });
    } else if (pageTransition.phase !== "home") {
      returnHome();
    }
  });
  function fitViewportZoom() {
    return initialView.zoom * (innerHeight / initialView.referenceHeight);
  }
  function resize() {
    const pixelRatio = Math.max(1, Math.min(1.5, devicePixelRatio || 1));
    canvas.width = Math.floor(innerWidth * pixelRatio);
    canvas.height = Math.floor(innerHeight * pixelRatio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    sceneState.zoom = fitViewportZoom() * pixelRatio;
  }
  addEventListener("resize", resize);
  resize();
  let dragState = null;
  function updateAmbientCamera(pointerX, pointerY) {
    const horizontalBias = (pointerX / innerWidth - .5) * 2;
    const verticalBias = (pointerY / innerHeight - .5) * 2;

    sceneState.targetYaw = sceneState.baseYaw + horizontalBias * .085;
    sceneState.targetPitch = Math.max(
      -1.5,
      Math.min(1.5, sceneState.basePitch - verticalBias * .065),
    );
  }
  canvas.onpointerdown = (event) => {
    if (sceneState.isInteractive) {
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startYaw: sceneState.yaw,
        startPitch: sceneState.pitch,
      };
      canvas.setPointerCapture(event.pointerId);
    } else {
      updateAmbientCamera(event.clientX, event.clientY);
    }
  };
  canvas.onpointermove = (event) => {
    if (sceneState.isInteractive && dragState) {
      sceneState.yaw = dragState.startYaw +
        (event.clientX - dragState.startX) * .008;
      sceneState.pitch = Math.max(
        -1.5,
        Math.min(
          1.5,
          dragState.startPitch + (event.clientY - dragState.startY) * .008,
        ),
      );
      sceneState.baseYaw = sceneState.yaw;
      sceneState.basePitch = sceneState.pitch;
    } else if (!sceneState.isInteractive && event.pointerType === "mouse") {
      updateAmbientCamera(event.clientX, event.clientY);
    }
  };
  addEventListener("pointermove", (event) => {
    if (!sceneState.isInteractive && event.pointerType === "mouse") {
      updateAmbientCamera(event.clientX, event.clientY);
    }
  }, { passive: true });
  canvas.onpointerup = () => dragState = null;
  canvas.onpointercancel = () => dragState = null;
  canvas.onwheel = (e) => {
    if (!sceneState.isInteractive) return;
    e.preventDefault();
    sceneState.zoom *= Math.exp(-e.deltaY * .001);
    sceneState.zoom = Math.max(34, Math.min(260, sceneState.zoom));
  };
  function daysSinceEpoch() {
    return sceneState.timeMs / MILLISECONDS_PER_DAY;
  }
  function localDayFraction() {
    const date = new Date(sceneState.timeMs);
    return (date.getHours() + date.getMinutes() / 60 +
      date.getSeconds() / 3600 +
      date.getMilliseconds() / 36e5) / 24;
  }
  function solarSeasonAngle() {
    const year = new Date(sceneState.timeMs).getFullYear();
    const equinoxTimeMs = new Date(year, 2, 20, 12).getTime();
    return FULL_TURN_RADIANS *
      ((sceneState.timeMs - equinoxTimeMs) / MILLISECONDS_PER_DAY) /
      DAYS_PER_TROPICAL_YEAR;
  }
  function lunarCycleAngle() {
    const lunarEpochTimeMs = Date.UTC(2000, 0, 6, 18, 14);
    return FULL_TURN_RADIANS *
      ((sceneState.timeMs - lunarEpochTimeMs) / MILLISECONDS_PER_DAY /
        LUNAR_MONTH_DAYS);
  }
  function solarDeclination() {
    return renderParams.axialTiltDegrees * Math.sin(solarSeasonAngle());
  }
  function lunarDeclination() {
    const lunarAngle = lunarCycleAngle();
    const ascendingNodeAngle = FULL_TURN_RADIANS *
      ((daysSinceEpoch() - 10957) / 6798);
    return renderParams.axialTiltDegrees *
        Math.sin(solarSeasonAngle() + lunarAngle) +
      renderParams.lunarInclinationDegrees *
        Math.sin(lunarAngle - ascendingNodeAngle);
  }
  function declinationOffset(declinationDegrees) {
    return renderParams.declinationScale * declinationDegrees /
      renderParams.axialTiltDegrees;
  }
  function sunDepth(depth) {
    return depth + declinationOffset(solarDeclination());
  }
  function moonDepth(depth) {
    return depth + declinationOffset(lunarDeclination());
  }
  function appendVertex(batch, position, color) {
    batch.positions.push(position.x, position.y, position.z);
    batch.colors.push(color[0], color[1], color[2], color[3]);
  }
  function appendLine(batch, start, end, color) {
    appendVertex(batch, start, color);
    appendVertex(batch, end, color);
  }
  function appendTriangle(batch, first, second, third, color) {
    appendVertex(batch, first, color);
    appendVertex(batch, second, color);
    appendVertex(batch, third, color);
  }
  function appendAnnulus(
    batch,
    depth,
    outerRadius,
    innerRadius,
    color,
    segmentCount = 300,
    startAngle = 0,
    endAngle = FULL_TURN_RADIANS,
  ) {
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      let startSegmentAngle = startAngle +
          (endAngle - startAngle) * segmentIndex / segmentCount,
        endSegmentAngle = startAngle +
          (endAngle - startAngle) * (segmentIndex + 1) / segmentCount,
        outerStart = celestialToWorld(
          vec3(
            outerRadius * Math.cos(startSegmentAngle),
            outerRadius * Math.sin(startSegmentAngle),
            depth,
          ),
        ),
        innerStart = celestialToWorld(
          vec3(
            innerRadius * Math.cos(startSegmentAngle),
            innerRadius * Math.sin(startSegmentAngle),
            depth,
          ),
        ),
        outerEnd = celestialToWorld(
          vec3(
            outerRadius * Math.cos(endSegmentAngle),
            outerRadius * Math.sin(endSegmentAngle),
            depth,
          ),
        ),
        innerEnd = celestialToWorld(
          vec3(
            innerRadius * Math.cos(endSegmentAngle),
            innerRadius * Math.sin(endSegmentAngle),
            depth,
          ),
        );
      appendTriangle(batch, outerStart, innerStart, outerEnd, color);
      appendTriangle(batch, outerEnd, innerStart, innerEnd, color);
    }
  }
  function appendSideWall(
    batch,
    lowerDepth,
    upperDepth,
    radius,
    color,
    segmentCount = 180,
  ) {
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      let startAngle = segmentIndex * FULL_TURN_RADIANS / segmentCount,
        endAngle = (segmentIndex + 1) * FULL_TURN_RADIANS / segmentCount,
        lowerStart = celestialToWorld(
          vec3(
            radius * Math.cos(startAngle),
            radius * Math.sin(startAngle),
            lowerDepth,
          ),
        ),
        lowerEnd = celestialToWorld(
          vec3(
            radius * Math.cos(endAngle),
            radius * Math.sin(endAngle),
            lowerDepth,
          ),
        ),
        upperStart = celestialToWorld(
          vec3(
            radius * Math.cos(startAngle),
            radius * Math.sin(startAngle),
            upperDepth,
          ),
        ),
        upperEnd = celestialToWorld(
          vec3(
            radius * Math.cos(endAngle),
            radius * Math.sin(endAngle),
            upperDepth,
          ),
        );
      appendTriangle(batch, lowerStart, lowerEnd, upperStart, color);
      appendTriangle(batch, upperStart, lowerEnd, upperEnd, color);
    }
  }
  function appendRingOcclusion(batch, depth, outerRadius, innerRadius) {
    appendAnnulus(
      batch,
      depth - renderParams.lineThickness,
      outerRadius,
      innerRadius,
      palette.black,
    );
    appendAnnulus(
      batch,
      depth + renderParams.lineThickness,
      outerRadius,
      innerRadius,
      palette.black,
    );
    appendSideWall(
      batch,
      depth - renderParams.lineThickness,
      depth + renderParams.lineThickness,
      outerRadius,
      palette.black,
    );
    appendSideWall(
      batch,
      depth - renderParams.lineThickness,
      depth + renderParams.lineThickness,
      innerRadius,
      palette.black,
    );
  }
  function circlePoints(
    depth,
    radius,
    segmentCount = 360,
    startAngle = 0,
    endAngle = FULL_TURN_RADIANS,
  ) {
    const points = [];
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const angle = startAngle +
        (endAngle - startAngle) * segmentIndex / segmentCount;
      points.push(
        celestialToWorld(
          vec3(radius * Math.cos(angle), radius * Math.sin(angle), depth),
        ),
      );
    }
    return points;
  }
  function drawThickPath(
    points,
    color,
    closed = true,
    thicknessPx = 3.5,
  ) {
    if (points.length < 2) return;

    const previousPoints = [],
      currentPoints = [],
      nextPoints = [],
      sideOffsets = [],
      vertexColors = [],
      pointCount = points.length,
      segmentCount = closed ? pointCount : pointCount - 1;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const startIndex = segmentIndex,
        endIndex = (segmentIndex + 1) % pointCount,
        triangleCorners = [
          [startIndex, -1],
          [startIndex, 1],
          [endIndex, -1],
          [endIndex, -1],
          [startIndex, 1],
          [endIndex, 1],
        ];

      for (const [pointIndex, sideOffset] of triangleCorners) {
        let previousPoint = points[(pointIndex - 1 + pointCount) % pointCount],
          currentPoint = points[pointIndex],
          nextPoint = points[(pointIndex + 1) % pointCount];

        if (!closed) {
          if (pointIndex === 0) {
            previousPoint = addVec3(
              currentPoint,
              subtractVec3(currentPoint, nextPoint),
            );
          }
          if (pointIndex === pointCount - 1) {
            nextPoint = addVec3(
              currentPoint,
              subtractVec3(currentPoint, previousPoint),
            );
          }
        }

        previousPoints.push(previousPoint.x, previousPoint.y, previousPoint.z);
        currentPoints.push(currentPoint.x, currentPoint.y, currentPoint.z);
        nextPoints.push(nextPoint.x, nextPoint.y, nextPoint.z);
        sideOffsets.push(sideOffset);
        vertexColors.push(color[0], color[1], color[2], color[3]);
      }
    }

    gl.useProgram(pathProgram);
    gl.uniformMatrix4fv(pathLocations.modelMatrix, false, rotationMatrix());
    gl.uniform2f(pathLocations.resolution, canvas.width, canvas.height);
    gl.uniform1f(
      pathLocations.zoom,
      sceneState.zoom * sceneState.zoomMultiplier,
    );
    gl.uniform1f(pathLocations.thickness, thicknessPx);

    function bindPathAttribute(
      buffer,
      attributeLocation,
      data,
      componentCount,
    ) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
      gl.vertexAttribPointer(
        attributeLocation,
        componentCount,
        gl.FLOAT,
        false,
        0,
        0,
      );
      gl.enableVertexAttribArray(attributeLocation);
    }

    bindPathAttribute(
      previousPathBuffer,
      pathLocations.previous,
      previousPoints,
      3,
    );
    bindPathAttribute(
      currentPathBuffer,
      pathLocations.current,
      currentPoints,
      3,
    );
    bindPathAttribute(nextPathBuffer, pathLocations.next, nextPoints, 3);
    bindPathAttribute(pathSideBuffer, pathLocations.side, sideOffsets, 1);
    bindPathAttribute(pathColorBuffer, pathLocations.color, vertexColors, 4);
    gl.drawArrays(gl.TRIANGLES, 0, currentPoints.length / 3);
    gl.useProgram(sceneProgram);
  }
  function drawRingLines(depth, outerRadius, innerRadius, color) {
    drawThickPath(
      circlePoints(
        depth - renderParams.lineThickness - .008,
        outerRadius,
        420,
      ),
      color,
      true,
      3.8,
    );
    drawThickPath(
      circlePoints(
        depth - renderParams.lineThickness - .008,
        innerRadius,
        420,
      ),
      color,
      true,
      3.8,
    );
    drawThickPath(
      circlePoints(
        depth + renderParams.lineThickness + .008,
        outerRadius,
        420,
      ),
      palette.white,
      true,
      3.8,
    );
    drawThickPath(
      circlePoints(
        depth + renderParams.lineThickness + .008,
        innerRadius,
        420,
      ),
      palette.white,
      true,
      3.8,
    );
  }
  function frontFacingAngle(depth, radius) {
    const center = worldToView(celestialToWorld(vec3(0, 0, depth)));
    const xPoint = worldToView(
      celestialToWorld(vec3(radius, 0, depth)),
    );
    const yPoint = worldToView(
      celestialToWorld(vec3(0, radius, depth)),
    );

    return Math.atan2(
      yPoint.z - center.z,
      xPoint.z - center.z,
    );
  }
  function appendBillboardTriangle(
    batch,
    tipWorld,
    previousWorld,
    color,
    sizePx = 13,
  ) {
    const tipView = worldToView(tipWorld);
    const previousView = worldToView(previousWorld);
    const direction = normalizeVec3(
      vec3(
        tipView.x - previousView.x,
        tipView.y - previousView.y,
        0,
      ),
    );
    const normal = vec3(-direction.y, direction.x, 0);
    const scale = sizePx * (canvas.width / innerWidth) / sceneState.zoom;
    const billboardBase = vec3(
      tipView.x - direction.x * scale,
      tipView.y - direction.y * scale,
      tipView.z,
    );
    const leftVertex = vec3(
      billboardBase.x + normal.x * scale * .55,
      billboardBase.y + normal.y * scale * .55,
      tipView.z,
    );
    const rightVertex = vec3(
      billboardBase.x - normal.x * scale * .55,
      billboardBase.y - normal.y * scale * .55,
      tipView.z,
    );

    appendTriangle(
      batch,
      viewToWorld(tipView),
      viewToWorld(leftVertex),
      viewToWorld(rightVertex),
      color,
    );
  }
  function appendCelestialArrow(
    arrowBatch,
    depth,
    radius,
    color,
  ) {
    const arrowAngle = frontFacingAngle(depth, radius) + Math.PI / 4;
    const arrowRadius = radius + .14;
    const arrowDepth = depth - renderParams.arrowDepthOffset;
    const tailAngle = .45;

    drawThickPath(
      circlePoints(
        arrowDepth,
        arrowRadius,
        80,
        arrowAngle + .22,
        arrowAngle - tailAngle,
      ),
      color,
      false,
      3.2,
    );

    const tipWorld = celestialToWorld(
      vec3(
        arrowRadius * Math.cos(arrowAngle - tailAngle),
        arrowRadius * Math.sin(arrowAngle - tailAngle),
        arrowDepth,
      ),
    );
    const previousWorld = celestialToWorld(
      vec3(
        arrowRadius * Math.cos(arrowAngle - tailAngle + .035),
        arrowRadius * Math.sin(arrowAngle - tailAngle + .035),
        arrowDepth,
      ),
    );

    appendBillboardTriangle(
      arrowBatch,
      tipWorld,
      previousWorld,
      color,
      15,
    );
  }
  function appendOcclusionSphere(batch) {
    const starRadius = renderParams.starRadius * .993;
    const latitudeSegments = 18;
    const longitudeSegments = 40;
    const minLatitude = -Math.PI / 2 + renderParams.latitudeMargin;
    const maxLatitude = Math.PI / 2 - renderParams.latitudeMargin;

    for (
      let latitudeIndex = 0;
      latitudeIndex < latitudeSegments;
      latitudeIndex++
    ) {
      const latitudeStart = minLatitude +
        latitudeIndex * (maxLatitude - minLatitude) / latitudeSegments;
      const latitudeEnd = minLatitude +
        (latitudeIndex + 1) * (maxLatitude - minLatitude) /
          latitudeSegments;

      for (
        let longitudeIndex = 0;
        longitudeIndex < longitudeSegments;
        longitudeIndex++
      ) {
        const longitudeStart = longitudeIndex * FULL_TURN_RADIANS /
          longitudeSegments;
        const longitudeEnd = (longitudeIndex + 1) * FULL_TURN_RADIANS /
          longitudeSegments;
        const corner00 = celestialToWorld(
          vec3(
            starRadius * Math.cos(latitudeStart) * Math.cos(longitudeStart),
            starRadius * Math.cos(latitudeStart) * Math.sin(longitudeStart),
            starRadius * Math.sin(latitudeStart),
          ),
        );
        const corner01 = celestialToWorld(
          vec3(
            starRadius * Math.cos(latitudeStart) * Math.cos(longitudeEnd),
            starRadius * Math.cos(latitudeStart) * Math.sin(longitudeEnd),
            starRadius * Math.sin(latitudeStart),
          ),
        );
        const corner10 = celestialToWorld(
          vec3(
            starRadius * Math.cos(latitudeEnd) * Math.cos(longitudeStart),
            starRadius * Math.cos(latitudeEnd) * Math.sin(longitudeStart),
            starRadius * Math.sin(latitudeEnd),
          ),
        );
        const corner11 = celestialToWorld(
          vec3(
            starRadius * Math.cos(latitudeEnd) * Math.cos(longitudeEnd),
            starRadius * Math.cos(latitudeEnd) * Math.sin(longitudeEnd),
            starRadius * Math.sin(latitudeEnd),
          ),
        );

        appendTriangle(batch, corner00, corner10, corner01, palette.black);
        appendTriangle(batch, corner01, corner10, corner11, palette.black);
      }
    }
  }
  function appendStarLoopArrow(arrowBatch, depth) {
    const starRadius = renderParams.starRadius;
    const radialRadius = Math.sqrt(
      Math.max(0, starRadius * starRadius - depth * depth),
    );
    const arrowAngle = frontFacingAngle(depth, radialRadius) + Math.PI / 4;
    const tipWorld = celestialToWorld(
      vec3(
        radialRadius * Math.cos(arrowAngle - .18),
        radialRadius * Math.sin(arrowAngle - .18),
        depth,
      ),
    );
    const previousWorld = celestialToWorld(
      vec3(
        radialRadius * Math.cos(arrowAngle - .14),
        radialRadius * Math.sin(arrowAngle - .14),
        depth,
      ),
    );

    appendBillboardTriangle(
      arrowBatch,
      tipWorld,
      previousWorld,
      palette.white,
      11,
    );
  }
  function celestialDepthDirection() {
    return worldToView(celestialToWorld(vec3(0, 0, 1))).z -
      worldToView(celestialToWorld(vec3(0, 0, 0))).z;
  }
  function allStarLoopDepths() {
    const starRadius = renderParams.starRadius;
    const minLatitude = -Math.PI / 2 + renderParams.latitudeMargin;
    const maxLatitude = Math.PI / 2 - renderParams.latitudeMargin;
    const depths = [];

    for (let latitudeIndex = 0; latitudeIndex < 5; latitudeIndex++) {
      const latitude = minLatitude +
        (maxLatitude - minLatitude) * latitudeIndex / 4;
      depths.push(starRadius * Math.sin(latitude));
    }

    return depths;
  }
  function visibleStarLoopDepths() {
    const depths = allStarLoopDepths();
    const cameraSide = celestialDepthDirection();

    if (cameraSide > .32) return depths.slice(1);
    if (cameraSide < -.32) return depths.slice(0, 4);
    return depths;
  }
  function drawStarLoops(arrowBatch, includeHeads = true) {
    const starRadius = renderParams.starRadius;

    for (const depth of visibleStarLoopDepths()) {
      const radialRadius = Math.sqrt(
        Math.max(0, starRadius * starRadius - depth * depth),
      );
      drawThickPath(
        circlePoints(depth, radialRadius, 420),
        palette.white,
        true,
        2.8,
      );
      if (includeHeads) appendStarLoopArrow(arrowBatch, depth);
    }
  }
  function appendStarLoopHeads(arrowBatch) {
    for (const depth of visibleStarLoopDepths()) {
      appendStarLoopArrow(arrowBatch, depth);
    }
  }
  function appendStarDots(starDotBatch) {
    const starRadius = renderParams.starRadius;

    for (let dotIndex = 0; dotIndex < 96; dotIndex += 2) {
      const angle = dotIndex * FULL_TURN_RADIANS / 96;
      appendVertex(
        starDotBatch,
        viewToWorld(
          vec3(
            starRadius * Math.cos(angle),
            starRadius * Math.sin(angle),
            0,
          ),
        ),
        palette.white,
      );
    }
  }
  function targetEarthScreenRadius() {
    const devicePixelRatio = canvas.width / innerWidth;
    const earthScale = renderParams.rayTargetScale || 1;

    return Math.max(
      1,
      renderParams.earthRadius * earthScale * sceneState.zoom *
        sceneState.zoomMultiplier / devicePixelRatio,
    );
  }
  function celestialRayScreenInfo(celestialBody) {
    const isSun = celestialBody === "sun";
    const innerRadius = isSun
      ? renderParams.sunInnerRadius
      : renderParams.moonInnerRadius;
    const outerRadius = isSun
      ? renderParams.sunOuterRadius
      : renderParams.moonOuterRadius;
    const depth = isSun ? sunDepth(0) : moonDepth(0);
    const color = isSun ? palette.sun : palette.moon;
    const idealAngle = isSun ? renderParams.sunAngle : renderParams.moonAngle;
    const phaseOffset = -(
      localDayFraction() * FULL_TURN_RADIANS +
      (isSun ? 0 : lunarCycleAngle())
    );
    const angle = idealAngle + phaseOffset;
    const sourcePoint = celestialToWorld(
      vec3(
        innerRadius * Math.cos(angle),
        innerRadius * Math.sin(angle),
        depth,
      ),
    );
    const outerPoint = celestialToWorld(
      vec3(
        outerRadius * Math.cos(angle),
        outerRadius * Math.sin(angle),
        depth,
      ),
    );
    const centerScreen = projectWorldToScreen(
      celestialToWorld(vec3(0, 0, depth)),
    );
    const earthScreen = projectWorldToScreen(vec3(0, 0, 0));
    const sourceScreen = projectWorldToScreen(sourcePoint);
    const outerScreen = projectWorldToScreen(outerPoint);
    const baseAngle = Math.atan2(
      sourceScreen.y - earthScreen.y,
      sourceScreen.x - earthScreen.x,
    );

    return {
      isSun,
      sourcePoint,
      earthScreen,
      sourceScreen,
      outerScreen,
      centerScreen,
      baseAngle,
      color,
    };
  }
  function screenToWorldAtEarthDepth(screenX, screenY) {
    const devicePixelRatio = canvas.width / innerWidth;
    const earthViewDepth = worldToView(vec3(0, 0, 0)).z;
    const zoom = sceneState.zoom * sceneState.zoomMultiplier;

    return viewToWorld(
      vec3(
        (screenX - innerWidth / 2) * devicePixelRatio / zoom,
        (innerHeight / 2 - screenY) * devicePixelRatio / zoom,
        earthViewDepth,
      ),
    );
  }
  function meanAngle(firstAngle, secondAngle) {
    return Math.atan2(
      Math.sin(firstAngle) + Math.sin(secondAngle),
      Math.cos(firstAngle) + Math.cos(secondAngle),
    );
  }
  function positionEarthLabel() {
    const sunRay = celestialRayScreenInfo("sun");
    const moonRay = celestialRayScreenInfo("moon");
    const earthScreenRadius = targetEarthScreenRadius();
    const oppositeAngle = meanAngle(
      sunRay.baseAngle,
      moonRay.baseAngle,
    ) + Math.PI;

    return {
      x: sunRay.earthScreen.x +
        Math.cos(oppositeAngle) * (earthScreenRadius + 20),
      y: sunRay.earthScreen.y +
        Math.sin(oppositeAngle) * (earthScreenRadius + 20),
      z: sunRay.earthScreen.z,
    };
  }
  function positionBodyLabel(celestialBody) {
    const ray = celestialRayScreenInfo(celestialBody);
    const horizontalOffset = ray.outerScreen.x - ray.centerScreen.x;
    const verticalOffset = ray.outerScreen.y - ray.centerScreen.y;
    const screenDistance = Math.hypot(horizontalOffset, verticalOffset) || 1;

    return {
      x: ray.outerScreen.x + horizontalOffset / screenDistance * 48,
      y: ray.outerScreen.y + verticalOffset / screenDistance * 48,
      z: ray.outerScreen.z,
    };
  }
  function positionStarsLabel() {
    const starTopPoint = projectWorldToScreen(
      viewToWorld(vec3(0, renderParams.starRadius, 0)),
    );
    return {
      x: starTopPoint.x,
      y: starTopPoint.y - 22,
      z: starTopPoint.z,
    };
  }
  function appendCelestialRays(batch) {
    const earthScreenRadius = targetEarthScreenRadius();
    const rayCount = 5;

    for (const celestialBody of ["sun", "moon"]) {
      const ray = celestialRayScreenInfo(celestialBody);
      const angularSpread = (ray.isSun ? 62 : 84) * Math.PI / 180;

      for (let rayIndex = 0; rayIndex < rayCount; rayIndex++) {
        const rayFraction = rayCount === 1 ? .5 : rayIndex / (rayCount - 1);
        const rayAngle = ray.baseAngle + (-.5 + rayFraction) * angularSpread;
        const targetScreenX = ray.earthScreen.x +
          Math.cos(rayAngle) * earthScreenRadius;
        const targetScreenY = ray.earthScreen.y +
          Math.sin(rayAngle) * earthScreenRadius;
        const targetWorld = screenToWorldAtEarthDepth(
          targetScreenX,
          targetScreenY,
        );

        appendLine(batch, ray.sourcePoint, targetWorld, ray.color);
      }
    }
  }
  function appendEarthGeometry(batch, earthScale = 1) {
    const segmentCount = 72;
    const radius = renderParams.earthRadius * earthScale;
    const halfHeight = renderParams.earthHalfHeight * earthScale;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const startAngle = segmentIndex * FULL_TURN_RADIANS / segmentCount;
      const endAngle = (segmentIndex + 1) * FULL_TURN_RADIANS / segmentCount;
      const lowerStart = vec3(
        radius * Math.cos(startAngle),
        -halfHeight,
        radius * Math.sin(startAngle),
      );
      const lowerEnd = vec3(
        radius * Math.cos(endAngle),
        -halfHeight,
        radius * Math.sin(endAngle),
      );
      const upperStart = vec3(
        radius * Math.cos(startAngle),
        halfHeight,
        radius * Math.sin(startAngle),
      );
      const upperEnd = vec3(
        radius * Math.cos(endAngle),
        halfHeight,
        radius * Math.sin(endAngle),
      );

      appendTriangle(batch, lowerStart, lowerEnd, upperStart, palette.white);
      appendTriangle(batch, upperStart, lowerEnd, upperEnd, palette.white);
      appendTriangle(
        batch,
        vec3(0, halfHeight, 0),
        upperStart,
        upperEnd,
        palette.white,
      );
      appendTriangle(
        batch,
        vec3(0, -halfHeight, 0),
        lowerEnd,
        lowerStart,
        palette.white,
      );
    }
  }
  function drawGeometryBatch(primitive, batch, pointSize = 3.5) {
    if (!batch.positions.length) return;

    gl.uniform1f(sceneLocations.pointSize, pointSize);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(batch.positions),
      gl.STREAM_DRAW,
    );
    gl.vertexAttribPointer(
      sceneLocations.position,
      3,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.enableVertexAttribArray(sceneLocations.position);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(batch.colors),
      gl.STREAM_DRAW,
    );
    gl.vertexAttribPointer(sceneLocations.color, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(sceneLocations.color);
    gl.drawArrays(primitive, 0, batch.positions.length / 3);
  }
  function drawScene({
    earthScale = 1,
    earthOnTop = false,
    zoomMultiplier = 1,
    whiteBackground = false,
  } = {}) {
    sceneState.zoomMultiplier = zoomMultiplier;
    gl.useProgram(sceneProgram);
    gl.uniformMatrix4fv(sceneLocations.modelMatrix, false, rotationMatrix());
    gl.uniform2f(sceneLocations.resolution, canvas.width, canvas.height);
    gl.uniform1f(sceneLocations.zoom, sceneState.zoom * zoomMultiplier);
    gl.clearColor(
      whiteBackground ? 1 : 0,
      whiteBackground ? 1 : 0,
      whiteBackground ? 1 : 0,
      1,
    );
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (whiteBackground) return;

    const occlusionGeometry = { positions: [], colors: [] },
      ringGeometry = { positions: [], colors: [] },
      arrowGeometry = { positions: [], colors: [] };

    appendOcclusionSphere(occlusionGeometry);
    drawGeometryBatch(gl.TRIANGLES, occlusionGeometry);
    drawStarLoops(arrowGeometry, false);
    drawThickPath(
      [
        celestialToWorld(vec3(0, 0, -5.5)),
        celestialToWorld(vec3(0, 0, 5.5)),
      ],
      palette.white,
      false,
      3.8,
    );
    appendRingOcclusion(
      ringGeometry,
      sunDepth(0),
      renderParams.sunOuterRadius,
      renderParams.sunInnerRadius,
    );
    appendRingOcclusion(
      ringGeometry,
      moonDepth(0),
      renderParams.moonOuterRadius,
      renderParams.moonInnerRadius,
    );
    drawGeometryBatch(gl.TRIANGLES, ringGeometry);
    drawRingLines(
      sunDepth(0),
      renderParams.sunOuterRadius,
      renderParams.sunInnerRadius,
      palette.sun,
    );
    drawRingLines(
      moonDepth(0),
      renderParams.moonOuterRadius,
      renderParams.moonInnerRadius,
      palette.moon,
    );
    appendCelestialArrow(
      arrowGeometry,
      sunDepth(0),
      renderParams.sunOuterRadius,
      palette.sun,
    );
    appendCelestialArrow(
      arrowGeometry,
      moonDepth(0),
      renderParams.moonOuterRadius,
      palette.moon,
    );
    drawGeometryBatch(gl.TRIANGLES, arrowGeometry);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const ringDepthGeometry = { positions: [], colors: [] };
    appendRingOcclusion(
      ringDepthGeometry,
      sunDepth(0),
      renderParams.sunOuterRadius,
      renderParams.sunInnerRadius,
    );
    appendRingOcclusion(
      ringDepthGeometry,
      moonDepth(0),
      renderParams.moonOuterRadius,
      renderParams.moonInnerRadius,
    );
    gl.colorMask(false, false, false, false);
    drawGeometryBatch(gl.TRIANGLES, ringDepthGeometry);
    gl.colorMask(true, true, true, true);

    const rayGeometry = { positions: [], colors: [] },
      arrowHeadGeometry = { positions: [], colors: [] },
      starDotGeometry = { positions: [], colors: [] };
    appendCelestialRays(rayGeometry);
    appendStarLoopHeads(arrowHeadGeometry);
    drawGeometryBatch(gl.TRIANGLES, arrowHeadGeometry);
    drawGeometryBatch(gl.LINES, rayGeometry);
    appendStarDots(starDotGeometry);
    drawGeometryBatch(gl.POINTS, starDotGeometry, 3.8);

    const earthGeometry = { positions: [], colors: [] };
    appendEarthGeometry(earthGeometry, earthScale);
    if (earthOnTop) gl.clear(gl.DEPTH_BUFFER_BIT);
    drawGeometryBatch(gl.TRIANGLES, earthGeometry);
  }

  function easeInOut(progress) {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return clampedProgress < .5
      ? 2 * clampedProgress * clampedProgress
      : 1 - Math.pow(-2 * clampedProgress + 2, 2) / 2;
  }
  function transitionProgress(nowMs) {
    return Math.max(
      0,
      Math.min(
        1,
        (nowMs - pageTransition.startedAtMs) / pageTransition.durationMs,
      ),
    );
  }
  function positionLabel(element, screenPosition) {
    element.style.left = screenPosition.x + "px";
    element.style.top = screenPosition.y + "px";
  }
  function updateLabelPositions() {
    const labelPositions = {
      sun: positionBodyLabel("sun"),
      moon: positionBodyLabel("moon"),
      earth: positionEarthLabel(),
      stars: positionStarsLabel(),
      N: projectWorldToScreen(celestialToWorld(vec3(0, 0, 5.65))),
      S: projectWorldToScreen(celestialToWorld(vec3(0, 0, -5.65))),
    };

    for (const labelName in labelPositions) {
      positionLabel(labels[labelName], labelPositions[labelName]);
    }
    for (const labelName in labels) {
      labels[labelName].classList.toggle(
        "hidden",
        pageTransition.phase !== "home",
      );
    }
  }
  function wrapUnitInterval(value) {
    return ((value % 1) + 1) % 1;
  }

  function heavensMood() {
    const sunDaily = wrapUnitInterval(localDayFraction());
    const moonDaily = wrapUnitInterval(
      localDayFraction() + lunarCycleAngle() / FULL_TURN_RADIANS,
    );
    const season = wrapUnitInterval(
      solarSeasonAngle() / FULL_TURN_RADIANS,
    );
    const phase = wrapUnitInterval(
      lunarCycleAngle() / FULL_TURN_RADIANS,
    );

    const agreement = Math.cos(FULL_TURN_RADIANS * (sunDaily - moonDaily));
    const warmth = Math.sin(FULL_TURN_RADIANS * season);
    const fullness = Math.cos(FULL_TURN_RADIANS * (phase - .5));
    const threshold = Math.cos(FULL_TURN_RADIANS * (sunDaily - .25));

    const omen = agreement * 1.25 +
      warmth * 1.1 +
      fullness * .85 +
      threshold * .65;

    if (omen > 2.25) return "the heavens are radiant";
    if (omen > 1.25) return "the heavens are happy";
    if (omen > .35) return "the heavens are pleased";
    if (omen > -.35) return "the heavens are inscrutable";
    if (omen > -1.25) return "the heavens are wistful";
    if (omen > -2.25) return "the heavens are sad";
    return "the heavens are inconsolable";
  }

  function updateReadouts() {
    const mood = heavensMood();

    getElement("datev").textContent = new Date(
      sceneState.timeMs,
    ).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    getElement("speedv").textContent = sceneState.timeScale.toFixed(0) + "×";
    getElement("heavensReadout").textContent = mood;
  }
  function renderFrame() {
    const nowMs = performance.now();
    const deltaSeconds = (nowMs - sceneState.previousFrameTime) / 1000;
    sceneState.previousFrameTime = nowMs;

    if (!sceneState.isInteractive) {
      const settleFactor = 1 - Math.exp(-deltaSeconds * 5.5);
      sceneState.yaw += (sceneState.targetYaw - sceneState.yaw) * settleFactor;
      sceneState.pitch += (sceneState.targetPitch - sceneState.pitch) *
        settleFactor;
    }
    if (sceneState.isPlaying) {
      sceneState.timeMs += deltaSeconds * 1000 * sceneState.timeScale;
      if (
        nowMs - sceneState.lastReadoutAt > 500 &&
        document.activeElement !== dateTimeInput
      ) {
        dateTimeInput.value = formatDateTimeInput(sceneState.timeMs);
      }
    }
    if (nowMs - sceneState.lastReadoutAt > 500) {
      updateReadouts();
      sceneState.lastReadoutAt = nowMs;
    }

    if (pageTransition.phase === "home" || pageTransition.phase === "loading") {
      drawScene({ earthOnTop: sceneState.earthOnTop });
      updateLabelPositions();
    } else if (pageTransition.phase === "entering") {
      const transitionAmount = transitionProgress(nowMs);
      const easedProgress = easeInOut(transitionAmount);
      const whiteBackground = transitionAmount > .56;

      drawScene({
        earthScale: 1 + easedProgress * 170,
        earthOnTop: true,
        zoomMultiplier: 1 + easedProgress * 8,
        whiteBackground,
      });
      updateLabelPositions();
      if (transitionAmount > .58) {
        setPageOverlayVisible(true);
      }
      if (transitionAmount >= .82) {
        pageTransition.phase = "open";
        setPageOverlayVisible(true);
      }
    } else if (pageTransition.phase === "open") {
      drawScene({
        earthOnTop: true,
        zoomMultiplier: 8,
        whiteBackground: true,
      });
    } else if (pageTransition.phase === "leaving") {
      const transitionAmount = transitionProgress(nowMs);
      const easedProgress = easeInOut(1 - transitionAmount);

      drawScene({
        earthScale: 1 + easedProgress * 170,
        earthOnTop: true,
        zoomMultiplier: 1 + easedProgress * 8,
        whiteBackground: transitionAmount < .16,
      });
      if (transitionAmount >= 1) {
        returnHome();
      }
    }
    if (renderingEnabled) frameRequestId = requestAnimationFrame(renderFrame);
  }

  const initialPage = pageDataForLocation();

  if (initialPage) {
    pageTransition.phase = "open";
    sceneState.earthOnTop = true;
    setPage(initialPage);
    setPageOverlayVisible(true, { focus: false });
    setSiteOverlayVisible(false);
    setModeToggleVisible(false);
  }

  if (renderingEnabled) {
    document.documentElement.classList.remove("no-webgl");
    document.documentElement.classList.add("webgl-ready");
    frameRequestId = requestAnimationFrame(renderFrame);
  }
})();
