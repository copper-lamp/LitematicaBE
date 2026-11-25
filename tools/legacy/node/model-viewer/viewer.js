// LitematicaBE 模型查看器 —— 前端逻辑
// 依赖: /vendor/three.min.js (r128) + /vendor/OrbitControls.js
(function () {
  'use strict';

  // ---------- 全局状态 ----------
  // 特殊纹理模式：按方块 material_instances 逐面映射（默认，最贴合项目 ghost 渲染）
  const AUTO = '__auto__';

  const state = {
    manifest: null,
    models: [],
    geometryMap: {},
    blocks: [],
    currentFile: null,
    currentModel: null,      // manifest.models 项
    currentGeometry: null,
    currentBlockId: null,
    currentTexture: AUTO,    // AUTO=逐面材质实例 | 'ghost_xxx'=强制单贴图 | null=纯色
    currentRenderMethod: null,
    currentTransform: null,  // JSON 字符串或 null
    currentMaterialInstances: {}, // 当前方块 material_instances（逐面贴图）
    wireframe: true,
    doubleSide: true,
    showBounds: false,
    showAxes: true,
  };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const modelList = $('#model-list');
  const searchInput = $('#search');
  const statsEl = $('#stats');
  const selBlock = $('#sel-block');
  const selTexture = $('#sel-texture');
  const selTransform = $('#sel-transform');
  const infoModel = $('#info-model');
  const infoGeo = $('#info-geo');
  const infoRender = $('#info-render');
  const variantLabel = $('#variant-label');
  const btnEdit = $('#btn-edit');
  const editorEl = $('#editor');
  const editorStatus = $('#editor-status');
  const edIdentifier = $('#ed-identifier');
  const edTexw = $('#ed-texw');
  const edTexh = $('#ed-texh');
  const edCubes = $('#ed-cubes');
  const edSelBody = $('#ed-sel-body');
  const edMaterials = $('#ed-materials');
  const edNewInst = $('#ed-new-inst');
  const edSaveStatus = $('#ed-save-status');
  const edJson = $('#ed-json');
  const edSave = $('#ed-save');
  const edPreview = $('#ed-preview');
  const edNew = $('#ed-new');
  const edLoadCurrent = $('#ed-load-current');
  const edAddCube = $('#ed-add-cube');
  const edDupCube = $('#ed-dup-cube');
  const edDelCube = $('#ed-del-cube');
  const edUndo = $('#ed-undo');
  const edRedo = $('#ed-redo');
  const edCancel = $('#ed-cancel');
  const edClose = $('#editor-close');

  // ---------- 编辑器状态 ----------
  const FACE_KEYS = ['north', 'south', 'east', 'west', 'up', 'down'];
  const FACE_LABEL = { north: '北', south: '南', east: '东', west: '西', up: '上', down: '下' };
  const editor = {
    enabled: false,
    model: null,            // { format_version, minecraft:geometry:[geom] }
    geom: null,             // 当前几何对象 {description, bones}
    cubeSel: -1,            // 选中的 cube 下标（-1 无）
    faceSel: null,          // 选中的面（north/south/east/west/up/down）
    materialInstances: {},  // 名称 -> { texture, render_method }
    renderMethod: 'blend',
    textures: [],           // 可用贴图名（现有 ghost + 上传）
    dirty: false,
    undoStack: [],          // 撤销快照栈
    redoStack: [],          // 重做快照栈
    baseline: null,         // 取消编辑时回退的基线快照
    pendingEdit: false,     // 是否在编辑爆发中（用于合并撤销步）
    editTimer: null,
  };
  const validationEl = $('#validation');
  const texPreview = $('#tex-preview');
  const texPreviewName = $('#tex-preview-name');

  // ---------- Three.js ----------
  const container = $('#viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16181d);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  const TARGET = new THREE.Vector3(0.5, 0.5, 0.5);
  camera.position.set(2.0, 1.8, 2.4);
  camera.lookAt(TARGET);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  // 灯光（用户要求无需光照，但保留环境光兜底，不影响 MeshBasicMaterial）
  scene.add(new THREE.AmbientLight(0xffffff, 1));

  // 地面网格（1 方块一格）
  const grid = new THREE.GridHelper(1, 1, 0x445566, 0x2a3038);
  grid.position.set(0.5, 0, 0.5);
  scene.add(grid);

  // 坐标轴
  const axes = new THREE.AxesHelper(0.75);
  axes.position.set(0, 0.001, 0);
  scene.add(axes);

  // 模型根节点
  const modelRoot = new THREE.Group();
  scene.add(modelRoot);

  // 选中面高亮（线框）
  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0xffcc33 })
  );
  highlight.visible = false;
  scene.add(highlight);

  const meshes = []; // 当前模型所有 cube mesh（用于线框切换）
  const cubeInfos = []; // 与 mesh 对应的 cube 元数据（raycast 用）

  // 包围盒
  let boundsHelper = null;

  const texLoader = new THREE.TextureLoader();
  const textureCache = {};

  function loadTexture(name) {
    if (!name) return null;
    if (textureCache[name]) return textureCache[name];
    const tex = texLoader.load('/rp/textures/blocks/ghost/' + name + '.png');
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    textureCache[name] = tex;
    return tex;
  }

  // 材质工厂：按 texture+renderMethod 缓存，供逐面/整体切换复用
  const allMaterials = [];
  const matCache = {};
  function makeMaterial(texture, renderMethod) {
    const key = (texture || '') + '|' + (renderMethod || '');
    if (matCache[key]) return matCache[key];
    let material;
    if (texture) {
      material = new THREE.MeshBasicMaterial({
        map: loadTexture(texture),
        side: state.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        transparent: renderMethod === 'blend',
        alphaTest: renderMethod === 'alpha_test' ? 0.5 : 0,
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        color: 0x88aacc,
        side: state.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        transparent: renderMethod === 'blend',
      });
    }
    material.wireframe = state.wireframe;
    matCache[key] = material;
    allMaterials.push(material);
    return material;
  }

  // ---------- 模型解析与几何构建 ----------

  function unitToBlockX(v) { return (v + 8) / 16; }
  function unitToBlockY(v) { return v / 16; }
  function unitToBlockZ(v) { return (v + 8) / 16; }

  // 将 Bedrock 图集 UV（左上原点）归一化为 three.js UV（左下原点）
  function atlasUV(u, v, w, h, texW, texH) {
    return [
      [u / texW, (texH - (v + h)) / texH],          // 左下
      [(u + w) / texW, (texH - (v + h)) / texH],    // 右下
      [(u + w) / texW, (texH - v) / texH],          // 右上
      [u / texW, (texH - v) / texH],                // 左上
    ];
  }

  // 构建单个 cube 的 BufferGeometry（居中于原点，尺寸以方块为单位）
  // faceMaterial: (faceKey) => materialIndex，用于逐面材质组；省略则全部材质 0
  function buildCubeGeometry(cube, texW, texH, faceMaterial) {
    const sx = cube.size[0] / 16;
    const sy = cube.size[1] / 16;
    const sz = cube.size[2] / 16;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;

    // 8 个角点（居中）
    const C = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz],
      [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz],
    ];

    // 六个面: look=外法向, up=纹理上方方向, cornerIdx=该面上的角点
    const faces = [
      { key: 'north', look: [0, 0, -1], up: [0, 1, 0], idx: [0, 1, 2, 3] },
      { key: 'south', look: [0, 0, 1], up: [0, 1, 0], idx: [4, 5, 6, 7] },
      { key: 'east', look: [1, 0, 0], up: [0, 1, 0], idx: [1, 3, 5, 7] },
      { key: 'west', look: [-1, 0, 0], up: [0, 1, 0], idx: [0, 2, 4, 6] },
      { key: 'up', look: [0, 1, 0], up: [0, 0, -1], idx: [2, 3, 6, 7] },
      { key: 'down', look: [0, -1, 0], up: [0, 0, 1], idx: [0, 1, 4, 5] },
    ];

    const positions = [];
    const uvs = [];
    const normals = [];
    const groups = []; // { start(vertex), count, materialIndex }

    let vertexCount = 0;
    for (const f of faces) {
      const uv = cube.uv ? cube.uv[f.key] : null;
      // 缺省面: 用整张图集
      const u0 = uv && uv.uv ? uv.uv[0] : 0;
      const v0 = uv && uv.uv ? uv.uv[1] : 0;
      const w0 = uv && uv.uv_size ? uv.uv_size[0] : texW;
      const h0 = uv && uv.uv_size ? uv.uv_size[1] : texH;
      const quadUV = atlasUV(u0, v0, w0, h0, texW, texH);

      // 面局部坐标系：right = look × up
      const look = new THREE.Vector3(...f.look);
      const up = new THREE.Vector3(...f.up);
      const right = new THREE.Vector3().crossVectors(look, up).normalize();

      // 按屏幕坐标归类到 BL/BR/TR/TL
      const corners = f.idx.map((i) => new THREE.Vector3(...C[i]));
      const screen = corners.map((p) => ({
        p,
        sx: p.dot(right),
        sy: p.dot(up),
      }));
      const minX = Math.min(...screen.map((s) => s.sx));
      const maxX = Math.max(...screen.map((s) => s.sx));
      const minY = Math.min(...screen.map((s) => s.sy));
      const maxY = Math.max(...screen.map((s) => s.sy));
      // 退化面（零厚度 cube 的侧面，屏幕范围≈0）直接跳过，避免共面塌缩
      if (maxX - minX < 1e-9 || maxY - minY < 1e-9) continue;
      const pos = {};
      for (const s of screen) {
        const kx = Math.abs(s.sx - minX) < 1e-9 ? 'L' : 'R';
        const ky = Math.abs(s.sy - minY) < 1e-9 ? 'B' : 'T';
        pos[kx + ky] = s.p;
      }
      // quadUV: 0=BL,1=BR,2=TR,3=TL
      const ordered = [pos.LB, pos.RB, pos.RT, pos.LT];
      const uvsQ = [quadUV[0], quadUV[1], quadUV[2], quadUV[3]];

      // 三角化 BL,BR,TR,TL —— 反绕序得到外法向（right=look×up 时 right×up=-look）
      const tris = [[0, 2, 1], [0, 3, 2]];
      const startVertex = vertexCount;
      for (const t of tris) {
        for (const ci of t) {
          positions.push(ordered[ci].x, ordered[ci].y, ordered[ci].z);
          uvs.push(uvsQ[ci][0], uvsQ[ci][1]);
          normals.push(look.x, look.y, look.z);
        }
      }
      vertexCount += 6;
      groups.push({ start: startVertex, count: 6, materialIndex: faceMaterial ? faceMaterial(f.key) : 0 });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
    return geo;
  }

  // 渲染整个模型 JSON
  function renderModel(modelJson, opts) {
    const {
      materialInstances = {},
      fallbackTexture = null,
      transform = null,
    } = opts || {};
    // 清空
    clearModel();

    const geomArr = modelJson['minecraft:geometry'] || [];
    for (const geom of geomArr) {
      const desc = geom.description || {};
      const texW = desc.texture_width || 16;
      const texH = desc.texture_height || 16;
      const bones = geom.bones || [];

      for (const bone of bones) {
        // bone 枢轴（模型单位 → 块坐标），作为变换节点
        const bp = bone.pivot || [0, 0, 0];
        const bonePivot = new THREE.Vector3(
          unitToBlockX(bp[0]), unitToBlockY(bp[1]), unitToBlockZ(bp[2])
        );
        const boneGroup = new THREE.Group();
        boneGroup.position.copy(bonePivot);
        if (bone.rotation) {
          boneGroup.rotation.set(
            THREE.MathUtils.degToRad(bone.rotation[0] || 0),
            THREE.MathUtils.degToRad(bone.rotation[1] || 0),
            THREE.MathUtils.degToRad(bone.rotation[2] || 0),
            'XYZ'
          );
        }

        const cubes = bone.cubes || [];
        for (const cube of cubes) {
          // 逐面贴图：面 -> material_instance -> 方块 material_instances[名称].texture
          // 与游戏引擎（ghost 渲染）一致；state.currentTexture 控制模式：
          //   AUTO  = 按方块 material_instances 逐面映射（默认，最贴合项目）
          //   null  = 纯色
          //   其它  = 强制所有面使用该贴图（调试）
          const cubeMatArray = [];
          const matIndexMap = {};
          const faceMatCb = (faceKey) => {
            const uv = cube.uv && cube.uv[faceKey];
            const instName = (uv && uv.material_instance) || '*';
            let inst = null;
            if (state.currentTexture === AUTO) {
              inst = (materialInstances && (materialInstances[instName] || materialInstances['*'])) || null;
            } else if (state.currentTexture === null) {
              inst = null;
            } else {
              inst = { texture: state.currentTexture, render_method: state.currentRenderMethod };
            }
            let texture = inst ? inst.texture : null;
            let render = inst ? inst.render_method : state.currentRenderMethod;
            if (!texture && state.currentTexture === AUTO) texture = fallbackTexture;
            const key = (texture || '') + '|' + (render || '');
            if (!(key in matIndexMap)) {
              matIndexMap[key] = cubeMatArray.length;
              cubeMatArray.push(makeMaterial(texture, render));
            }
            return matIndexMap[key];
          };

          const geo = buildCubeGeometry(cube, texW, texH, faceMatCb);
          const mesh = new THREE.Mesh(geo, cubeMatArray.length === 1 ? cubeMatArray[0] : cubeMatArray);

          // cube 中心（块坐标）
          const center = new THREE.Vector3(
            unitToBlockX(cube.origin[0]) + (cube.size[0] / 16) / 2,
            unitToBlockY(cube.origin[1]) + (cube.size[1] / 16) / 2,
            unitToBlockZ(cube.origin[2]) + (cube.size[2] / 16) / 2
          );

          const cubeGroup = new THREE.Group();
          if (cube.rotation && cube.pivot) {
            // 绕自身 pivot 旋转：pivot 相对 bonePivot，mesh 相对 pivot
            const anchor = new THREE.Vector3(
              unitToBlockX(cube.pivot[0]),
              unitToBlockY(cube.pivot[1]),
              unitToBlockZ(cube.pivot[2])
            );
            cubeGroup.position.copy(anchor).sub(bonePivot);
            mesh.position.copy(center).sub(anchor);
            cubeGroup.rotation.set(
              THREE.MathUtils.degToRad(cube.rotation[0] || 0),
              THREE.MathUtils.degToRad(cube.rotation[1] || 0),
              THREE.MathUtils.degToRad(cube.rotation[2] || 0),
              'XYZ'
            );
          } else {
            // 无旋转：中心相对 bonePivot
            cubeGroup.position.copy(center).sub(bonePivot);
          }

          cubeGroup.add(mesh);
          boneGroup.add(cubeGroup);

          meshes.push(mesh);
          cubeInfos.push({ cube, mesh, center });
        }
        modelRoot.add(boneGroup);
      }

      // 包围盒
      if (state.showBounds) {
        buildBoundsHelper(desc);
      }
    }

    applyTransform(transform);
    updateFaceVisibility();
  }

  function buildBoundsHelper(desc) {
    if (boundsHelper) {
      modelRoot.remove(boundsHelper);
      boundsHelper.geometry.dispose();
      boundsHelper = null;
    }
    const w = desc.visible_bounds_width || 1;
    const h = desc.visible_bounds_height || 1;
    const off = desc.visible_bounds_offset || [0, 0, 0];
    // 包围盒：中心 = 方块中心(0.5,0.5,0.5) + offset，尺寸 = (width, height, width)
    const geo = new THREE.BoxGeometry(w, h, w);
    boundsHelper = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x66ccff })
    );
    boundsHelper.position.set(0.5 + off[0], 0.5 + off[1], 0.5 + off[2]);
    modelRoot.add(boundsHelper);
  }

  function applyTransform(transform) {
    // 重置
    modelRoot.position.set(0, 0, 0);
    modelRoot.rotation.set(0, 0, 0);
    modelRoot.scale.set(1, 1, 1);
    modelRoot.updateMatrixWorld(true);

    if (!transform) return;
    let t = transform;
    if (typeof transform === 'string') {
      try { t = JSON.parse(transform); } catch (e) { return; }
    }
    const rot = t.rotation || [0, 0, 0];
    const scl = t.scale || [1, 1, 1];
    const trn = t.translation || [0, 0, 0];
    // 绕方块中心旋转
    const pivot = new THREE.Group();
    pivot.position.set(0.5, 0.5, 0.5);
    const inner = new THREE.Group();
    inner.position.set(-0.5, -0.5, -0.5);
    while (modelRoot.children.length) {
      inner.add(modelRoot.children[0]);
    }
    pivot.add(inner);
    pivot.rotation.set(
      THREE.MathUtils.degToRad(rot[0] || 0),
      THREE.MathUtils.degToRad(rot[1] || 0),
      THREE.MathUtils.degToRad(rot[2] || 0),
      'XYZ'
    );
    pivot.scale.set(scl[0] || 1, scl[1] || 1, scl[2] || 1);
    modelRoot.add(pivot);
    modelRoot.position.set(trn[0] || 0, trn[1] || 0, trn[2] || 0);
  }

  function clearModel() {
    while (modelRoot.children.length) {
      const c = modelRoot.children.pop();
      disposeGroup(c);
    }
    meshes.length = 0;
    cubeInfos.length = 0;
    boundsHelper = null;
    highlight.visible = false;
  }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // 材质缓存在 matCache 中复用（按 texture|method），不在此释放；
      // 贴图缓存在 textureCache 中复用。仅释放几何。
    });
  }

  function updateFaceVisibility() {
    // 遍历所有已创建的材质（含多面多材质）
    for (const mat of allMaterials) {
      mat.side = state.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
      mat.wireframe = state.wireframe;
    }
    grid.visible = true;
    axes.visible = state.showAxes;
  }

  // ---------- 变体/分组 ----------

  function familyOf(file) {
    let base = file.replace(/\.json$/, '').replace(/^lit_/, '');
    base = base.replace(/_(on|open|up|sub)$/, '');
    base = base.replace(/_(l\d+|d\d+|f\d+)$/, '');
    return base;
  }

  function variantLabelOf(file) {
    return file.replace(/\.json$/, '').replace(/^lit_/, '');
  }

  function familyMembers(fam) {
    return state.models.filter((m) => familyOf(m.file) === fam).map((m) => m.file);
  }

  // ---------- 列表渲染 ----------
  function renderList() {
    const q = (searchInput.value || '').trim().toLowerCase();
    modelList.innerHTML = '';
    const fams = new Map();
    for (const m of state.models) {
      const fam = familyOf(m.file);
      if (!fams.has(fam)) fams.set(fam, []);
      fams.get(fam).push(m);
    }
    const famNames = [...fams.keys()].sort();
    for (const fam of famNames) {
      const members = fams.get(fam).filter((m) =>
        !q || m.file.toLowerCase().includes(q) || m.identifier.toLowerCase().includes(q)
      );
      if (members.length === 0) continue;
      const li = document.createElement('li');
      li.className = 'grp';
      li.textContent = fam + '（' + members.length + '）';
      modelList.appendChild(li);
      for (const m of members) {
        const item = document.createElement('li');
        item.dataset.file = m.file;
        const span = document.createElement('span');
        span.className = 'gname';
        span.textContent = variantLabelOf(m.file);
        const b = document.createElement('span');
        b.className = 'bones';
        b.textContent = m.bones + ' bone' + (m.bones !== 1 ? 's' : '');
        item.appendChild(span);
        item.appendChild(b);
        if (m.file === state.currentFile) item.classList.add('active');
        item.addEventListener('click', () => selectModel(m.file));
        modelList.appendChild(item);
      }
    }
  }

  // ---------- 选择模型 ----------
  async function selectModel(file) {
    state.currentFile = file;
    state.currentModel = state.models.find((m) => m.file === file);
    if (!state.currentModel) return;
    state.currentGeometry = state.currentModel.identifier;

    // 高亮列表
    document.querySelectorAll('#model-list li').forEach((li) => li.classList.toggle('active', li.dataset.file === file));

    // 信息
    infoModel.value = file;
    infoGeo.value = state.currentGeometry;

    // 载入模型 JSON
    let modelJson;
    try {
      const r = await fetch('/rp/models/blocks/' + encodeURIComponent(file));
      modelJson = await r.json();
    } catch (e) {
      validationEl.innerHTML = '<span class="err">加载失败: ' + e.message + '</span>';
      return;
    }
    // 缓存供编辑器「从当前载入」
    state.currentModelJson = modelJson;
    state.currentFormatVersion = modelJson.format_version || '1.19.0';

    // 候选方块（使用该几何的 BP 方块）
    const candidates = state.geometryMap[state.currentGeometry] || [];
    const blockIds = [...new Set(candidates.map((c) => c.blockId))].sort();
    selBlock.innerHTML = '';
    if (blockIds.length) {
      for (const id of blockIds) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = id;
        selBlock.appendChild(o);
      }
      // 保留仍有效的当前方块选择
      const keepBlock = state.currentBlockId && blockIds.includes(state.currentBlockId)
        ? state.currentBlockId : blockIds[0];
      state.currentBlockId = keepBlock;
      selBlock.value = keepBlock;
      refreshTextureOptions(keepBlock);
    } else {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（无关联方块）';
      selBlock.appendChild(o);
      refreshTextureOptions(null);
    }

    // 变体导航
    const fam = familyOf(file);
    const members = familyMembers(fam);
    const idx = members.indexOf(file);
    variantLabel.textContent = (idx + 1) + ' / ' + members.length + ' · ' + variantLabelOf(file) + '（' + fam + '）';

    // 渲染
    const block = state.blocks.find((b) => b.id === state.currentBlockId);
    if (editor.enabled) {
      renderEditorModel();
    } else {
      renderModel(modelJson, {
        materialInstances: (block && block.materialInstances) || {},
        fallbackTexture: (block && block.textures && block.textures[0]) || null,
        transform: state.currentTransform,
      });
    }
    showValidation(modelJson);
  }

  function refreshTextureOptions(blockId) {
    selTexture.innerHTML = '';
    let textures = [];
    let renderMethod = null;
    let materialInstances = {};
    if (blockId) {
      const block = state.blocks.find((b) => b.id === blockId);
      if (block) {
        textures = block.textures.slice();
        renderMethod = block.renderMethods[0] || null;
        materialInstances = block.materialInstances || {};
      }
    }
    state.currentMaterialInstances = materialInstances;
    // 自动（逐面材质实例）选项 —— 默认，最贴合项目 ghost 渲染
    const auto = document.createElement('option');
    auto.value = AUTO;
    auto.textContent = '（自动·逐面材质实例）';
    selTexture.appendChild(auto);
    // 各贴图
    for (const t of textures) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      selTexture.appendChild(o);
    }
    // 纯色选项
    const solid = document.createElement('option');
    solid.value = '';
    solid.textContent = '（纯色）';
    selTexture.appendChild(solid);
    // 保留仍有效的当前纹理，否则用自动模式
    state.currentTexture = (state.currentTexture !== null && (state.currentTexture === AUTO || textures.includes(state.currentTexture)))
      ? state.currentTexture : AUTO;
    selTexture.value = state.currentTexture;
    state.currentRenderMethod = renderMethod;
    infoRender.value = renderMethod || 'opaque';

    // 变换选项
    refreshTransformOptions(blockId);

    // 预览
    showTexturePreview(state.currentTexture);
  }

  function refreshTransformOptions(blockId) {
    selTransform.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '（无变换 / 模型原样）';
    selTransform.appendChild(none);
    let transforms = [];
    if (blockId) {
      const block = state.blocks.find((b) => b.id === blockId);
      if (block && block.transforms) transforms = block.transforms;
    }
    const seen = new Set();
    for (const t of transforms) {
      if (seen.has(t)) continue;
      seen.add(t);
      const o = document.createElement('option');
      o.value = t;
      let label = t;
      try {
        const j = JSON.parse(t);
        label = 'rot[' + (j.rotation || [0, 0, 0]).join(',') + '] scale[' + (j.scale || [1, 1, 1]).join(',') + '] tr[' + (j.translation || [0, 0, 0]).join(',') + ']';
      } catch (e) { /* 保留原样 */ }
      o.textContent = label;
      selTransform.appendChild(o);
    }
    // 保留仍有效的当前变换
    state.currentTransform = (state.currentTransform && seen.has(state.currentTransform))
      ? state.currentTransform : null;
    selTransform.value = state.currentTransform || '';
  }

  function showTexturePreview(name) {
    const ctx = texPreview.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    if (name === AUTO) {
      // 自动模式：预览方块首个纹理，并标注逐面
      const firstTex = Object.values(state.currentMaterialInstances)[0];
      const first = firstTex ? firstTex.texture : null;
      texPreviewName.textContent = first ? ('自动·逐面（示例: ' + first + '.png）') : '自动·逐面材质实例';
      if (first) drawTexPreview(first);
      return;
    }
    if (!name) {
      ctx.fillStyle = '#88aacc';
      ctx.fillRect(0, 0, 128, 128);
      texPreviewName.textContent = '纯色（无贴图）';
      return;
    }
    texPreviewName.textContent = name + '.png';
    drawTexPreview(name);
  }

  function drawTexPreview(name) {
    const ctx = texPreview.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 128, 128);
    };
    img.src = '/rp/textures/blocks/ghost/' + name + '.png';
  }

  // ---------- 校验 ----------
  function showValidation(modelJson) {
    const geom = modelJson['minecraft:geometry'] && modelJson['minecraft:geometry'][0];
    const lines = [];
    const add = (cls, txt) => lines.push('<span class="' + cls + '">' + txt + '</span>');
    if (!geom) { add('err', '✗ 缺少 minecraft:geometry'); validationEl.innerHTML = lines.join('\n'); return; }
    const desc = geom.description || {};
    add('ok', '✓ identifier: ' + (desc.identifier || '?'));
    add('ok', '✓ format_version: ' + (modelJson.format_version || '?'));
    add('ok', '✓ 纹理图集: ' + (desc.texture_width || 16) + '×' + (desc.texture_height || 16));
    const texW = desc.texture_width || 16;
    const texH = desc.texture_height || 16;
    const bones = geom.bones || [];
    let cubeCount = 0;
    for (const b of bones) cubeCount += (b.cubes || []).length;
    add('ok', '✓ bones: ' + bones.length + '，cubes: ' + cubeCount);

    let warn = 0, err = 0;
    for (const b of bones) {
      if (b.rotation && !b.pivot) { warn++; add('warn', '⚠ bone "' + b.name + '" 有 rotation 无 pivot'); }
      for (const c of (b.cubes || [])) {
        const o = c.origin, s = c.size;
        if (!o || !s || o.length !== 3 || s.length !== 3) { err++; add('err', '✗ cube 缺 origin/size'); continue; }
        if (s.some((v) => v < 0)) { err++; add('err', '✗ cube 负尺寸 [' + s.join(',') + ']'); }
        if (s.some((v) => v > 16)) { warn++; add('warn', '⚠ cube 尺寸超格 [' + s.join(',') + ']'); }
        // 越界
        const x0 = unitToBlockX(o[0]), z0 = unitToBlockZ(o[2]);
        const y0 = unitToBlockY(o[1]);
        const x1 = x0 + s[0] / 16, y1 = y0 + s[1] / 16, z1 = z0 + s[2] / 16;
        if (x0 < -0.001 || z0 < -0.001 || x1 > 1.001 || z1 > 1.001) { warn++; add('warn', '⚠ cube 超出 1 格水平范围 [' + o.join(',') + ']'); }
        if (y0 < -0.001 || y1 > 1.001) { warn++; add('warn', '⚠ cube 超出 1 格垂直范围 [' + o.join(',') + ']'); }
        // UV 检查 + 材质实例引用检查
        if (c.uv) {
          for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
            const f = c.uv[face];
            if (!f) continue;
            const u = f.uv && f.uv[0], v = f.uv && f.uv[1];
            const w = f.uv_size && f.uv_size[0], h = f.uv_size && f.uv_size[1];
            if (u + w > texW + 0.001 || v + h > texH + 0.001) {
              warn++;
              add('warn', '⚠ face ' + face + ' UV 超出图集 [' + u + ',' + v + ' ' + w + '×' + h + ']');
            }
            // material_instance 必须能落到方块的 material_instances（或 '*'）
            const instName = f.material_instance || '*';
            if (!(instName in state.currentMaterialInstances) && !(instName === '*')) {
              warn++;
              add('warn', '⚠ face ' + face + ' 引用未定义的材质实例 "' + instName + '"');
            }
          }
        } else {
          warn++; add('warn', '⚠ cube 无 uv（使用整张图集）');
        }
      }
    }
    if (warn === 0 && err === 0) add('ok', '✓ 未发现结构问题');
    else if (err === 0) add('ok', '✓ 结构 OK（' + warn + ' 条警告）');
    else add('err', '✗ 发现 ' + err + ' 处错误');
    validationEl.innerHTML = lines.join('\n');
  }

  // ---------- 相机 ----------
  function setCam(pos) {
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.copy(TARGET);
    controls.update();
  }

  // ---------- 事件绑定 ----------
  searchInput.addEventListener('input', renderList);

  selBlock.addEventListener('change', () => {
    state.currentBlockId = selBlock.value;
    refreshTextureOptions(selBlock.value);
    reRender();
  });

  selTexture.addEventListener('change', () => {
    // AUTO 是特殊值，保留字符串；'' → null(纯色)
    const raw = selTexture.value;
    state.currentTexture = raw === '' ? null : raw;
    const block = state.blocks.find((b) => b.id === state.currentBlockId);
    state.currentRenderMethod = block ? (block.renderMethods[0] || null) : null;
    infoRender.value = state.currentRenderMethod || 'opaque';
    showTexturePreview(state.currentTexture);
    reRender();
  });

  selTransform.addEventListener('change', () => {
    state.currentTransform = selTransform.value || null;
    applyTransform(state.currentTransform);
  });

  $('#btn-wire').addEventListener('click', function () {
    state.wireframe = !state.wireframe;
    this.classList.toggle('active', state.wireframe);
    updateFaceVisibility();
  });
  $('#btn-doubleside').addEventListener('click', function () {
    state.doubleSide = !state.doubleSide;
    this.classList.toggle('active', state.doubleSide);
    updateFaceVisibility();
  });
  $('#btn-bounds').addEventListener('click', function () {
    state.showBounds = !state.showBounds;
    this.classList.toggle('active', state.showBounds);
    // 重新渲染以刷新包围盒
    if (state.currentFile) selectModel(state.currentFile);
  });
  $('#btn-axes').addEventListener('click', function () {
    state.showAxes = !state.showAxes;
    this.classList.toggle('active', state.showAxes);
    axes.visible = state.showAxes;
  });
  $('#btn-reset').addEventListener('click', () => setCam([2.0, 1.8, 2.4]));
  document.querySelectorAll('[data-cam]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = b.dataset.cam;
      if (c === 'front') setCam([0.5, 0.5, 2.6]);
      else if (c === 'top') setCam([0.5, 3.0, 0.5]);
      else if (c === 'iso') setCam([2.2, 1.8, 2.2]);
    });
  });

  $('#btn-prev').addEventListener('click', () => navigateVariant(-1));
  $('#btn-next').addEventListener('click', () => navigateVariant(1));
  $('#btn-reload').addEventListener('click', () => init(true));

  function navigateVariant(dir) {
    if (!state.currentFile) return;
    const fam = familyOf(state.currentFile);
    const members = familyMembers(fam);
    const idx = members.indexOf(state.currentFile);
    let next = idx + dir;
    if (next < 0) next = members.length - 1;
    if (next >= members.length) next = 0;
    selectModel(members[next]);
  }

  // raycast 高亮
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener('mousemove', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const hit = hits[0];
      highlight.visible = true;
      const info = cubeInfos.find((ci) => ci.mesh === hit.object);
      if (info) {
        highlight.position.copy(info.center);
        highlight.scale.set(info.cube.size[0] / 16 + 0.002, info.cube.size[1] / 16 + 0.002, info.cube.size[2] / 16 + 0.002);
      }
    } else {
      highlight.visible = false;
    }
  });

  function reRender() {
    if (editor.enabled) { renderEditorModel(); return; }
    if (!state.currentFile) return;
    selectModel(state.currentFile);
  }

  // 编辑器模式下点击选中 cube + 精确面（射线拾取）
  renderer.domElement.addEventListener('click', (e) => {
    if (!editor.enabled) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return;
    const hit = hits[0];
    const info = cubeInfos.find((ci) => ci.mesh === hit.object);
    if (!info) return;
    const idx = editor.geom.bones[0].cubes.indexOf(info.cube);
    if (idx < 0) return;
    // 精确面：由命中面的本地法向判定（cube 几何居中，法向轴对齐）
    const face = faceFromNormal(hit.face && hit.face.normal);
    editor.cubeSel = idx;
    editor.faceSel = face;
    buildEditorCubes();
    buildEditorSelected();
    scheduleEditorRender();
  });

  // ---------- 编辑器 ----------
  const cloneJson = (o) => JSON.parse(JSON.stringify(o));

  function editorMarkDirty() {
    editor.dirty = true;
    editorStatus.textContent = '● 已修改';
  }

  // 生成 cube 某面的默认 UV 尺寸（模型单位）
  function defaultFaceUvSize(cube, face) {
    const s = cube.size;
    if (face === 'north' || face === 'south') return [s[0], s[1]];
    if (face === 'east' || face === 'west') return [s[2], s[1]];
    return [s[0], s[2]]; // up/down
  }

  function newDefaultCube() {
    const cube = { origin: [0, 0, 0], size: [16, 16, 16] };
    cube.uv = {};
    for (const f of FACE_KEYS) {
      cube.uv[f] = { uv: [0, 0], uv_size: defaultFaceUvSize(cube, f), material_instance: '*' };
    }
    return cube;
  }

  // 确保编辑器有 geometry + 一个 bone
  function editorEnsureGeom() {
    if (!editor.model) {
      editor.model = { format_version: '1.19.0', 'minecraft:geometry': [] };
    }
    if (!editor.model['minecraft:geometry'].length) {
      editor.model['minecraft:geometry'].push({
        description: {
          identifier: edIdentifier.value.trim() || 'geometry.lit_editor',
          texture_width: Number(edTexw.value) || 16,
          texture_height: Number(edTexh.value) || 16,
        },
        bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [] }],
      });
    }
    editor.geom = editor.model['minecraft:geometry'][0];
    if (!editor.geom.bones || !editor.geom.bones.length) {
      editor.geom.bones = [{ name: 'body', pivot: [0, 0, 0], cubes: [] }];
    }
    if (!editor.geom.bones[0].cubes) editor.geom.bones[0].cubes = [];
  }

  function toggleEditor(force) {
    const on = force !== undefined ? force : !editor.enabled;
    editor.enabled = on;
    editorEl.classList.toggle('hidden', !on);
    btnEdit.classList.toggle('active', on);
    if (on) {
      if (!editor.model) editorLoadFromCurrent();
      editorEnsureGeom();
      editorRefreshAll();
      edUndo.disabled = editor.undoStack.length === 0;
      edRedo.disabled = editor.redoStack.length === 0;
      editorStatus.textContent = editor.dirty ? '● 已修改' : '就绪';
    } else {
      editorStatus.textContent = '';
    }
    reRender();
  }

  function editorLoadFromCurrent() {
    if (!state.currentModelJson) { editorNew(); return; }
    // 从当前选中的模型载入：取 bones[0] 作为可编辑骨，合并说明
    const geom = cloneJson(state.currentModelJson['minecraft:geometry'][0]);
    if (!geom || !geom.bones || !geom.bones.length) { editorNew(); return; }
    const bones = geom.bones;
    const editable = bones[0];
    if (bones.length > 1) {
      editorStatus.textContent = '仅编辑第 1 个 bone（共 ' + bones.length + ' 个）';
    }
    // 只保留可编辑 bone
    geom.bones = [editable];
    editor.model = {
      format_version: state.currentFormatVersion || '1.19.0',
      'minecraft:geometry': [geom],
    };
    editor.geom = geom;
    editor.cubeSel = -1;
    editor.faceSel = null;
    edIdentifier.value = (geom.description && geom.description.identifier) || 'geometry.lit_editor';
    edTexw.value = (geom.description && geom.description.texture_width) || 16;
    edTexh.value = (geom.description && geom.description.texture_height) || 16;
    editor.materialInstances = cloneJson(state.currentMaterialInstances || {});
    editor.textures = collectAllTextureNames();
    editor.renderMethod = state.currentRenderMethod || 'blend';
    editor.dirty = false;
    editor.undoStack = [];
    editor.redoStack = [];
    editor.baseline = editorSnapshotState();
    editor.pendingEdit = false;
  }

  function collectAllTextureNames() {
    const set = new Set();
    for (const b of state.blocks) for (const t of (b.textures || [])) set.add(t);
    return [...set].sort();
  }

  function editorNew() {
    editor.model = {
      format_version: '1.19.0',
      'minecraft:geometry': [{
        description: {
          identifier: 'geometry.lit_editor',
          texture_width: 16,
          texture_height: 16,
        },
        bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [newDefaultCube()] }],
      }],
    };
    editor.geom = editor.model['minecraft:geometry'][0];
    editor.cubeSel = 0;
    edIdentifier.value = 'geometry.lit_editor';
    edTexw.value = 16;
    edTexh.value = 16;
    editor.materialInstances = {};
    editor.textures = collectAllTextureNames();
    editor.renderMethod = 'blend';
    editor.dirty = true;
    editor.cubeSel = 0;
    editor.faceSel = null;
    editor.undoStack = [];
    editor.redoStack = [];
    editor.baseline = editorSnapshotState();
    editor.pendingEdit = false;
  }

  // ---------- 撤销 / 重做 / 取消编辑 ----------
  function editorSnapshotState() {
    return {
      model: cloneJson(editor.model),
      materialInstances: cloneJson(editor.materialInstances),
    };
  }

  function editorRestoreState(s) {
    editor.model = s.model;
    editor.geom = s.model['minecraft:geometry'][0];
    editor.materialInstances = cloneJson(s.materialInstances);
    const cubes = editor.geom.bones[0].cubes;
    if (editor.cubeSel >= cubes.length) editor.cubeSel = cubes.length - 1;
    if (editor.faceSel && !cubes[editor.cubeSel]) editor.faceSel = null;
    edIdentifier.value = (editor.geom.description && editor.geom.description.identifier) || 'geometry.lit_editor';
    edTexw.value = (editor.geom.description && editor.geom.description.texture_width) || 16;
    edTexh.value = (editor.geom.description && editor.geom.description.texture_height) || 16;
    editorMarkDirty();
    editorRefreshAll();
  }

  // 在一次编辑改动前调用：把当前状态压入撤销栈（合并同一次拖动/输入的连续改动为一个撤销步）
  function editorEditStart() {
    if (!editor.pendingEdit) {
      editor.undoStack.push(editorSnapshotState());
      if (editor.undoStack.length > 100) editor.undoStack.shift();
      editor.redoStack = [];
      editor.pendingEdit = true;
      edUndo.disabled = false;
      edRedo.disabled = true;
    }
    clearTimeout(editor.editTimer);
    editor.editTimer = setTimeout(() => { editor.pendingEdit = false; }, 700);
  }

  function editorUndo() {
    if (!editor.undoStack.length) return;
    const s = editor.undoStack.pop();
    editor.redoStack.push(editorSnapshotState());
    editor.pendingEdit = false;
    editorRestoreState(s);
    edUndo.disabled = editor.undoStack.length === 0;
    edRedo.disabled = editor.redoStack.length === 0;
    editorStatus.textContent = '↶ 已撤销';
  }

  function editorRedo() {
    if (!editor.redoStack.length) return;
    const s = editor.redoStack.pop();
    editor.undoStack.push(editorSnapshotState());
    editor.pendingEdit = false;
    editorRestoreState(s);
    edUndo.disabled = editor.undoStack.length === 0;
    edRedo.disabled = editor.redoStack.length === 0;
    editorStatus.textContent = '↷ 已重做';
  }

  function editorCancelEdit() {
    if (!editor.baseline) { toggleEditor(false); return; }
    editor.pendingEdit = false;
    editorRestoreState(cloneJson(editor.baseline));
    editor.dirty = false;
    editorStatus.textContent = '↩ 已取消编辑（恢复打开时状态）';
    toggleEditor(false);
  }

  function renderEditorModel() {
    if (!editor.enabled || !editor.model) return;
    editorEnsureGeom();
    const saved = state.currentTexture;
    state.currentTexture = AUTO;
    try {
      renderModel(editor.model, {
        materialInstances: editor.materialInstances,
        fallbackTexture: null,
        transform: null,
      });
    } catch (e) {
      // 编辑过程中可能瞬时出现非法几何（如 size=0），不中断编辑
      console.warn('编辑器渲染异常（忽略）:', e && e.message || e);
    }
    state.currentTexture = saved;
    updateEditorFaceHighlight();
  }

  // ---------- 精确面选中 ----------
  // 根据射线命中面的本地法向判断是哪个面
  function faceFromNormal(n) {
    if (!n) return null;
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax >= ay && ax >= az) return n.x > 0 ? 'east' : 'west';
    if (az >= ax && az >= ay) return n.z > 0 ? 'south' : 'north';
    return n.y > 0 ? 'up' : 'down';
  }

  // 选中面的 4 角（cube 局部居中坐标，沿法向外偏移 0.004 避免共面闪烁）
  function faceCorners(cube, face) {
    const hx = cube.size[0] / 16 / 2, hy = cube.size[1] / 16 / 2, hz = cube.size[2] / 16 / 2;
    const o = 0.004;
    switch (face) {
      case 'north': return [[-hx, -hy, -hz - o], [hx, -hy, -hz - o], [hx, hy, -hz - o], [-hx, hy, -hz - o]];
      case 'south': return [[hx, -hy, hz + o], [-hx, -hy, hz + o], [-hx, hy, hz + o], [hx, hy, hz + o]];
      case 'east': return [[hx + o, -hy, -hz], [hx + o, -hy, hz], [hx + o, hy, hz], [hx + o, hy, -hz]];
      case 'west': return [[-hx - o, -hy, hz], [-hx - o, -hy, -hz], [-hx - o, hy, -hz], [-hx - o, hy, hz]];
      case 'up': return [[-hx, hy + o, -hz], [hx, hy + o, -hz], [hx, hy + o, hz], [-hx, hy + o, hz]];
      case 'down': return [[-hx, -hy - o, hz], [hx, -hy - o, hz], [hx, -hy - o, -hz], [-hx, -hy - o, -hz]];
      default: return null;
    }
  }

  let faceHighlight = null;
  function updateEditorFaceHighlight() {
    if (faceHighlight) {
      if (faceHighlight.parent) faceHighlight.parent.remove(faceHighlight);
      faceHighlight.geometry.dispose();
      faceHighlight = null;
    }
    if (!editor.enabled) return;
    const cube = editor.geom && editor.geom.bones[0].cubes[editor.cubeSel];
    if (!cube || !editor.faceSel) return;
    const info = cubeInfos.find((ci) => ci.cube === cube);
    if (!info) return;
    const pts = faceCorners(cube, editor.faceSel);
    if (!pts) return;
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    faceHighlight = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffd24a }));
    info.mesh.add(faceHighlight);
  }

  // 合帧调度：每帧至多重建一次，既实时又避免高频输入卡顿
  let edRenderQueued = false;
  function scheduleEditorRender() {
    if (edRenderQueued) return;
    edRenderQueued = true;
    requestAnimationFrame(() => {
      edRenderQueued = false;
      renderEditorModel();
    });
  }

  function editorRefreshAll() {
    editorEnsureGeom();
    buildEditorCubes();
    buildEditorSelected();
    buildEditorMaterials();
    scheduleEditorRender();
  }

  function buildEditorCubes() {
    const cubes = editor.geom.bones[0].cubes;
    edCubes.innerHTML = '';
    if (!cubes.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '（无方块，点击“添加方块”）';
      edCubes.appendChild(li);
      return;
    }
    cubes.forEach((c, i) => {
      const li = document.createElement('li');
      if (i === editor.cubeSel) li.className = 'sel';
      const size = c.size || [0, 0, 0];
      li.innerHTML = '<span class="ci">#' + i + '</span>' +
        '<span>origin [' + (c.origin || [0, 0, 0]).join(',') + '] size [' + size.join(',') + ']</span>';
      li.addEventListener('click', () => editorSelectCube(i));
      edCubes.appendChild(li);
    });
  }

  function editorSelectCube(i) {
    editor.cubeSel = i;
    editor.faceSel = null;
    buildEditorCubes();
    buildEditorSelected();
    scheduleEditorRender();
  }

  function editorSelectFace(face) {
    editor.faceSel = face;
    buildEditorSelected();
    scheduleEditorRender();
  }

  // 某 cube 某面的贴图（经 material_instance → 材质实例）
  function faceTextureOf(cube, face) {
    const uv = cube.uv && cube.uv[face];
    const instName = (uv && uv.material_instance) || '*';
    const inst = editor.materialInstances[instName] || editor.materialInstances['*'];
    return inst ? inst.texture : null;
  }

  // 统一「选中方块」面板：面网格（点选） + 选中面 UV/材质 + 几何输入
  function buildEditorSelected() {
    const cube = editor.geom.bones[0].cubes[editor.cubeSel];
    edSelBody.innerHTML = '';
    if (!cube) {
      edSelBody.innerHTML = '<span class="muted">未选中方块</span>';
      return;
    }
    if (!cube.uv) cube.uv = {};
    const wrap = document.createElement('div');
    wrap.className = 'ed-sel';

    // 面网格：点击精确选中该面贴图
    const grid = document.createElement('div');
    grid.className = 'ed-facegrid';
    for (const face of FACE_KEYS) {
      if (!cube.uv[face]) cube.uv[face] = { uv: [0, 0], uv_size: defaultFaceUvSize(cube, face), material_instance: '*' };
      const cell = document.createElement('button');
      cell.className = 'ed-facecell' + (editor.faceSel === face ? ' sel' : '');
      const tex = faceTextureOf(cube, face);
      cell.innerHTML = '<span class="ff">' + FACE_LABEL[face] + '</span><span class="ft">' + (tex || '·') + '</span>';
      cell.title = face + ' → ' + (tex || '未指定材质实例');
      cell.addEventListener('click', () => editorSelectFace(face));
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);

    // 选中面：材质实例 + UV 编辑
    const f = editor.faceSel;
    if (f && cube.uv[f]) {
      const uv = cube.uv[f];
      const row = document.createElement('div');
      row.className = 'ed-faceuv';
      const lab = document.createElement('span');
      lab.className = 'fk';
      lab.textContent = FACE_LABEL[f] + '·' + f;
      row.appendChild(lab);
      const inst = document.createElement('select');
      const names = ['*', ...Object.keys(editor.materialInstances)];
      for (const n of names) {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        inst.appendChild(o);
      }
      inst.value = uv.material_instance || '*';
      inst.addEventListener('change', () => {
        editorEditStart();
        uv.material_instance = inst.value;
        editorMarkDirty();
        scheduleEditorRender();
        buildEditorSelected();
      });
      row.appendChild(inst);
      const mkNum = (val, cb) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        input.value = val;
        input.addEventListener('input', () => {
          editorEditStart();
          cb(Number(input.value) || 0);
          editorMarkDirty();
          scheduleEditorRender();
        });
        return input;
      };
      row.appendChild(mkNum(uv.uv[0], (v) => uv.uv[0] = v));
      row.appendChild(mkNum(uv.uv[1], (v) => uv.uv[1] = v));
      row.appendChild(mkNum(uv.uv_size[0], (v) => uv.uv_size[0] = v));
      row.appendChild(mkNum(uv.uv_size[1], (v) => uv.uv_size[1] = v));
      wrap.appendChild(row);
    } else {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.textContent = '点 3D 面或上方网格，编辑该面贴图 / UV';
      wrap.appendChild(hint);
    }

    // 几何输入
    const props = document.createElement('div');
    props.className = 'ed-props';
    const v3 = (label, arr) => {
      const lab = document.createElement('label');
      lab.className = 'wide';
      lab.textContent = label;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '4px';
      for (let k = 0; k < 3; k++) {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        input.value = arr[k];
        input.addEventListener('input', () => {
          editorEditStart();
          arr[k] = Number(input.value) || 0;
          editorMarkDirty();
          scheduleEditorRender();
          buildEditorCubes();
        });
        row.appendChild(input);
      }
      lab.appendChild(row);
      props.appendChild(lab);
    };
    v3('origin', cube.origin);
    v3('size', cube.size);
    if (!cube.rotation) cube.rotation = [0, 0, 0];
    if (!cube.pivot) cube.pivot = [0, 0, 0];
    v3('rotation(°)', cube.rotation);
    v3('pivot', cube.pivot);
    wrap.appendChild(props);

    edSelBody.appendChild(wrap);
  }

  function buildEditorMaterials() {
    edMaterials.innerHTML = '';
    for (const name of Object.keys(editor.materialInstances)) {
      const inst = editor.materialInstances[name];
      const row = document.createElement('div');
      row.className = 'ed-mat';
      const mn = document.createElement('span');
      mn.className = 'mn';
      mn.textContent = name;
      row.appendChild(mn);
      // 贴图文本输入
      const texInput = document.createElement('input');
      texInput.type = 'text';
      texInput.value = inst.texture || '';
      texInput.placeholder = '贴图名';
      texInput.addEventListener('change', () => {
        editorEditStart();
        inst.texture = texInput.value.trim() || null;
        editorMarkDirty();
        scheduleEditorRender();
      });
      row.appendChild(texInput);
      // 上传按钮
      const up = document.createElement('button');
      up.textContent = '📁';
      up.title = '上传 PNG 作为该实例贴图';
      up.addEventListener('click', () => uploadTextureForInstance(name, inst, texInput));
      row.appendChild(up);
      // render_method 选择
      const rm = document.createElement('select');
      for (const m of ['blend', 'alpha_test', 'opaque']) {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m;
        rm.appendChild(o);
      }
      rm.value = inst.render_method || 'blend';
      rm.addEventListener('change', () => {
        editorEditStart();
        inst.render_method = rm.value;
        editorMarkDirty();
        scheduleEditorRender();
      });
      row.appendChild(rm);
      // 删除
      const del = document.createElement('button');
      del.className = 'ed-mat-del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        editorEditStart();
        delete editor.materialInstances[name];
        editorMarkDirty();
        editorRefreshAll();
      });
      row.appendChild(del);
      edMaterials.appendChild(row);
    }
    if (!Object.keys(editor.materialInstances).length) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.textContent = '（无材质实例；方块默认用 "*"）';
      edMaterials.appendChild(hint);
    }
  }

  // 为某材质实例上传 PNG 贴图
  function uploadTextureForInstance(instName, inst, texInput) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.split(',')[1] || '';
        let texName = (texInput.value || '').trim() || instName;
        texName = texName.replace(/[^a-zA-Z0-9_]/g, '');
        if (!texName) { edSaveStatus.textContent = '贴图名为空'; edSaveStatus.className = 'ed-save-status err'; return; }
        edSaveStatus.textContent = '上传 ' + texName + '.png …';
        edSaveStatus.className = 'ed-save-status';
        try {
          const r = await fetch('/api/editor/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              textures: [{ name: texName, base64 }],
              registerTextures: [texName],
            }),
          });
          const res = await r.json();
          if (!res.ok) throw new Error(res.error || '上传失败');
          editorEditStart();
          inst.texture = texName;
          texInput.value = texName;
          if (!editor.textures.includes(texName)) editor.textures.push(texName);
          edSaveStatus.textContent = '已上传贴图 ✓ (' + (res.saved || []).join('、') + ')';
          edSaveStatus.className = 'ed-save-status ok';
          editorMarkDirty();
          scheduleEditorRender();
        } catch (e) {
          edSaveStatus.textContent = '上传失败: ' + (e && e.message || e);
          edSaveStatus.className = 'ed-save-status err';
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // 生成模型 JSON（minecraft:geometry）
  function editorMakeModelJson() {
    editorEnsureGeom();
    editor.geom.description.identifier = edIdentifier.value.trim() || 'geometry.lit_editor';
    editor.geom.description.texture_width = Number(edTexw.value) || 16;
    editor.geom.description.texture_height = Number(edTexh.value) || 16;
    return {
      format_version: editor.model.format_version || '1.19.0',
      'minecraft:geometry': [cloneJson(editor.geom)],
    };
  }

  // 生成方块 JSON（minecraft:block，与项目 g_*.json 一致）
  function editorMakeBlockJson() {
    const identifier = edIdentifier.value.trim() || 'geometry.lit_editor';
    const short = identifier.replace(/^geometry\./, '');
    const materialInstances = {};
    for (const [name, inst] of Object.entries(editor.materialInstances)) {
      const m = { render_method: inst.render_method || 'blend' };
      if (inst.texture) m.texture = inst.texture;
      m.face_dimming = false;
      m.ambient_occlusion = false;
      materialInstances[name] = m;
    }
    if (!materialInstances['*']) {
      materialInstances['*'] = { render_method: 'blend', face_dimming: false, ambient_occlusion: false };
    }
    return {
      format_version: '1.21.0',
      'minecraft:block': {
        description: { identifier: 'lit:g_' + short, menu_category: { category: 'none' } },
        components: {
          'minecraft:geometry': identifier,
          'minecraft:material_instances': materialInstances,
          'minecraft:collision_box': false,
          'minecraft:selection_box': false,
          'minecraft:destructible_by_mining': false,
          'minecraft:destructible_by_explosion': false,
          'minecraft:replaceable': {},
          'minecraft:light_dampening': 0,
          'minecraft:map_color': '#888888',
        },
        permutations: [],
      },
    };
  }

  function editorSave() {
    editorEnsureGeom();
    const identifier = edIdentifier.value.trim() || 'geometry.lit_editor';
    const short = identifier.replace(/^geometry\./, '');
    const modelFile = short + '.json';
    const blockFile = 'g_' + short + '.json';
    const payload = {
      modelFile,
      model: editorMakeModelJson(),
      blockFile,
      block: editorMakeBlockJson(),
      textures: [],
      registerTextures: [],
    };
    // 收集所有材质实例用到的贴图（若不在现有纹理列表中且未上传过，仍尝试注册）
    for (const inst of Object.values(editor.materialInstances)) {
      if (inst.texture) payload.registerTextures.push(inst.texture);
    }
    edSaveStatus.textContent = '保存中…';
    edSaveStatus.className = 'ed-save-status';
    fetch('/api/editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) throw new Error((res.errors || []).join('；') || res.error || '保存失败');
        edSaveStatus.textContent = '✓ 已保存:\n' + (res.saved || []).join('\n');
        edSaveStatus.className = 'ed-save-status ok';
        editor.dirty = false;
        editorStatus.textContent = '就绪';
        // 若保存的模型是当前几何，提示刷新 manifest
        edJson.textContent = JSON.stringify({ model: payload.model, block: payload.block }, null, 2);
        edJson.classList.remove('hidden');
      })
      .catch((e) => {
        edSaveStatus.textContent = '保存失败: ' + (e && e.message || e);
        edSaveStatus.className = 'ed-save-status err';
      });
  }

  function editorPreviewJson() {
    edJson.textContent = JSON.stringify({
      model: editorMakeModelJson(),
      block: editorMakeBlockJson(),
    }, null, 2);
    edJson.classList.remove('hidden');
  }

  // 编辑器按钮绑定
  btnEdit.addEventListener('click', () => toggleEditor());
  edClose.addEventListener('click', () => toggleEditor(false));
  edNew.addEventListener('click', () => { editorNew(); editorRefreshAll(); });
  edLoadCurrent.addEventListener('click', () => { editorLoadFromCurrent(); editorRefreshAll(); });
  edAddCube.addEventListener('click', () => {
    editorEnsureGeom();
    const cubes = editor.geom.bones[0].cubes;
    editorEditStart();
    cubes.push(newDefaultCube());
    editor.cubeSel = cubes.length - 1;
    editor.faceSel = null;
    editorRefreshAll();
  });
  edDupCube.addEventListener('click', () => {
    const cubes = editor.geom.bones[0].cubes;
    if (editor.cubeSel < 0 || editor.cubeSel >= cubes.length) return;
    editorEditStart();
    const copy = cloneJson(cubes[editor.cubeSel]);
    cubes.splice(editor.cubeSel + 1, 0, copy);
    editor.cubeSel = editor.cubeSel + 1;
    editor.faceSel = null;
    editorRefreshAll();
  });
  edDelCube.addEventListener('click', () => {
    const cubes = editor.geom.bones[0].cubes;
    if (editor.cubeSel < 0 || editor.cubeSel >= cubes.length) return;
    editorEditStart();
    cubes.splice(editor.cubeSel, 1);
    if (editor.cubeSel >= cubes.length) editor.cubeSel = cubes.length - 1;
    editor.faceSel = null;
    editorRefreshAll();
  });
  edSave.addEventListener('click', editorSave);
  edPreview.addEventListener('click', editorPreviewJson);
  edUndo.addEventListener('click', editorUndo);
  edRedo.addEventListener('click', editorRedo);
  edCancel.addEventListener('click', editorCancelEdit);
  // 撤销/重做快捷键（文本框内保留原生撤销）
  document.addEventListener('keydown', (e) => {
    if (!editor.enabled) return;
    const t = e.target;
    const isText = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'search')));
    if (isText) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) editorRedo();
      else editorUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      editorRedo();
    }
  });
  edNewInst.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const name = edNewInst.value.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!name) return;
    editorEditStart();
    editor.materialInstances[name] = { texture: null, render_method: 'blend' };
    edNewInst.value = '';
    editorMarkDirty();
    buildEditorMaterials();
    buildEditorSelected();
    scheduleEditorRender();
  });

  // 图集尺寸 / 标识符 变更 → 实时重渲染（图集尺寸影响 UV 归一化）
  function edApplyAtlas() {
    editorEnsureGeom();
    editorEditStart();
    if (editor.geom.description) {
      editor.geom.description.texture_width = Number(edTexw.value) || 16;
      editor.geom.description.texture_height = Number(edTexh.value) || 16;
    }
    editorMarkDirty();
    scheduleEditorRender();
  }
  edTexw.addEventListener('input', edApplyAtlas);
  edTexh.addEventListener('input', edApplyAtlas);
  edIdentifier.addEventListener('input', () => {
    editorEnsureGeom();
    editorEditStart();
    if (editor.geom.description) editor.geom.description.identifier = edIdentifier.value.trim() || 'geometry.lit_editor';
    editorMarkDirty();
  });

  // ---------- 尺寸 ----------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ---------- 初始化 ----------
  async function init(reload) {
    try {
      const r = await fetch('/manifest.json?t=' + Date.now());
      state.manifest = await r.json();
    } catch (e) {
      statsEl.textContent = 'manifest 加载失败';
      return;
    }
    state.models = state.manifest.models || [];
    state.geometryMap = state.manifest.geometryMap || {};
    state.blocks = state.manifest.blocks || [];
    statsEl.textContent = '模型 ' + state.manifest.modelCount + ' · 方块 ' + state.manifest.blockCount + ' · 几何 ' + Object.keys(state.geometryMap).length;
    renderList();
    resize();
    animate();
    if (reload) return;
    // 默认选中第一个模型
    if (state.models.length) {
      selectModel(state.models[0].file);
    }
  }

  let animating = false;
  function animate() {
    if (animating) return;
    animating = true;
    const loop = () => {
      requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  init(false);
})();
