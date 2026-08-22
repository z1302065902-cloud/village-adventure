/**
 * Web 3D 游戏核心模块
 * 使用 Three.js r160 + Draco 压缩 GLB
 *
 * 控制方式（自包含 FPS 相机，无第三方控制冲突）：
 * - 鼠标左键按住拖拽 = 旋转视角（无需点击锁定，直接拖拽）
 * - 滚轮 = 缩放
 * - WASD = 前后左右移动
 * - F / 空格 = 攻击（空格不再飞升）
 * - Ctrl = 下降；滚轮 = 调高度
 * - Shift + WASD = 加速
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.keys = {};

    // FPS 视点：接近真人头高，平视时能看见前方地面上的怪/水晶
    this.eye = new THREE.Vector3(-4, 2.2, 10);
    this.yaw = -0.30;
    this.pitch = 0.12;
    this.isDragging = false;
    this.pointerLocked = false;
    this.yawSens = 0.005;
    this.pitchSens = 0.0025;    // 俯仰仍弱于左右
    this.pitchLimit = 1.0;      // 约 ±57°，能低头看清地面
    this.sensitivity = 0.005;
    this.turnSpeed = 2.2;
    this.lastPointer = { x: 0, y: 0 };
    this.moveSpeed = 8;
    this.moveVector = new THREE.Vector3();

    // 音频管理（Web Audio 程序化合成，零外部文件依赖）
    this.audio = null;
    this.lastStepTime = 0;

    // ===== 游戏核心状态（关卡/Boss/战斗） =====
    this.maxHp = 100;
    this.hp = 100;
    this.gameState = 'playing';   // playing | won | dead | victory
    this.levelIndex = 0;
    this.hitStop = 0;
    this.floatTexts = [];
    this.spawnProtect = 0;
    this.analytics = { events: [] };
    this._sessionId = 's' + Date.now().toString(36);
    this.SAVE_KEY = 'village_adventure_v1';
    this.awaitingStart = true;

    // 10 关：前段偏短易通，适合 itch 单局 5–10 分钟
    this.levels = [
      { name: '关卡1 · 新手：收集水晶', type: 'collect', goal: 5,  progress: 0, hint: '走到发光水晶旁收集 (5/5) — 教程关' },
      { name: '关卡2 · 消灭魔化野兽',   type: 'hunt',    goal: 4,  progress: 0, hint: '击杀前方带红标的野兽 (4/4)' },
      { name: '关卡3 · 守卫兽潮',       type: 'hunt',    goal: 6,  progress: 0, hint: '击退兽群 (6/6)' },
      { name: '关卡4 · 收集能量水晶',   type: 'collect', goal: 8,  progress: 0, hint: '收集散落的能量水晶 (8/8)' },
      { name: '关卡5 · 蛮荒领主',       type: 'boss',    goal: 1,  progress: 0, hint: '击败蛮荒领主!', boss: { name: '蛮荒领主', hp: 24, maxHp: 24, scale: 0.72, color: 0xa01818, dmg: 12, speed: 4.0, cd: 2.0, animal: 'Horse', style: 'warlord' } },
      { name: '关卡6 · 收集能量水晶',   type: 'collect', goal: 10, progress: 0, hint: '收集散落的能量水晶 (10/10)' },
      { name: '关卡7 · 精英魔化兽',     type: 'hunt',    goal: 8,  progress: 0, hint: '清剿精英魔化兽 (8/8)' },
      { name: '关卡8 · 暗影魔狼',       type: 'hunt',    goal: 10, progress: 0, hint: '猎杀暗影魔狼群 (10/10)' },
      { name: '关卡9 · 深渊裂隙',       type: 'boss',    goal: 1,  progress: 0, hint: '击败深渊魔王!', boss: { name: '深渊魔王', hp: 48, maxHp: 48, scale: 0.82, color: 0x5a28ff, dmg: 18, speed: 4.4, cd: 1.7, animal: 'Zebra', style: 'abyss' } },
      { name: '关卡10 · 世界之巅',      type: 'boss',    goal: 1,  progress: 0, hint: '击败灭世者·终焉!', boss: { name: '灭世者·终焉', hp: 72, maxHp: 72, scale: 0.95, color: 0x8b0000, dmg: 22, speed: 4.8, cd: 1.4, animal: 'Cow', style: 'end' } },
    ];
    this.bossConfig = null;
    this.enemies = [];
    this.currentEnemies = 0;
    this.pickups = [];
    this.boss = null;
    this.bossSpawned = false;
    this.attackCooldown = 0;
    this._lastHitId = 0;

    this.init();
    this.loadScene();
    this.loadAnimals();
    this.loadCharacters();
    this.setupInput();
    this._wireMetaUI();
    setTimeout(() => { this.audio = new AudioManager(); }, 0);

    const params = new URLSearchParams(location.search);
    const demo = params.get('demo') === '1';
    const bootLv = (() => {
      const n = parseInt(params.get('level'), 10);
      if (n >= 1 && n <= this.levels.length) return n - 1;
      return null;
    })();

    if (demo) {
      this.awaitingStart = false;
      this._hideTitle();
      setTimeout(() => {
        this.startLevel(bootLv != null ? bootLv : 1);
        this._startDemoReel();
      }, 900);
    } else if (bootLv != null) {
      this.awaitingStart = false;
      this._hideTitle();
      setTimeout(() => this.startLevel(bootLv), 800);
    } else {
      this._showTitle();
      this.track('app_open');
    }
    this.animate();
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 45, 120);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    // 站在地面上的第一人称视角
    this.applyRotation();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.15);
    this.scene.add(ambientLight);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x6a8f5a, 0.55);
    this.scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xfff2dd, 1.35);
    dirLight.position.set(40, 80, 30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);

    window.addEventListener('resize', () => this.onResize());
    this.addBoundaryVisual();
    console.log('🎮 游戏初始化完成');
  }

  // 边界可视化提示（半透明围栏柱 + 顶部灯带）
  addBoundaryVisual() {
    const HALF = 19.0;
    const group = new THREE.Group();
    // 四角柱子
    const corners = [
      [-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]
    ];
    const postMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7 });
    for (const [x, z] of corners) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 4, 8),
        postMat
      );
      post.position.set(x, 2, z);
      group.add(post);
    }
    // 边界光线（线框边框，贴地 0.05m，宽 40m）
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 });
    const pts = [
      new THREE.Vector3(-HALF, 0.1, -HALF),
      new THREE.Vector3(HALF, 0.1, -HALF),
      new THREE.Vector3(HALF, 0.1, HALF),
      new THREE.Vector3(-HALF, 0.1, HALF),
      new THREE.Vector3(-HALF, 0.1, -HALF),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      lineMat
    );
    group.add(line);
    this.scene.add(group);
  }

  loadScene() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      'scene_optimized.glb',
      (gltf) => {
        this.scene.add(gltf.scene);
        this._collideMeshes = null;
        console.log('✅ 场景加载成功 (' + gltf.scene.children.length + ' 个对象)');
        this._reseatVillageAnimals();
      },
      () => {},
      (error) => {
        console.error('❌ 加载失败:', error);
      }
    );
  }

  // 加载真实骨骼动画动物（Quaternius CC0 可商用，每只独立 GLB）
  // 必须 SkeletonUtils.clone：普通 clone(true) 会断蒙皮，只剩几何体/红标
  loadAnimals() {
    this.animals = [];
    this.mixers = [];
    this.animalCatalog = {}; // name -> { template, animations } 供猎杀关克隆
    // 每种动物 2 只，共 14 只
    const species = ['Cow', 'Horse', 'Zebra', 'Llama', 'Pig', 'Pug', 'Sheep'];
    const loader = new GLTFLoader();
    const spots = this._scatterSpots(species.length * 2);
    let loaded = 0;
    const total = species.length * 2;

    species.forEach((name, i) => {
      loader.load(
        'assets/animals/' + name + '.glb',
        (gltf) => {
          const template = gltf.scene;
          const animations = gltf.animations || [];
          // 模板永不入场景；村庄与敌人都从它 skeletonClone
          this.animalCatalog[name] = { template, animations };

          for (let copy = 0; copy < 2; copy++) {
            const inst = skeletonClone(template);
            this._prepareAnimalVisual(inst);
            inst.scale.setScalar(0.48);
            const spot = spots[(i * 2 + copy) % spots.length];
            // 脚底贴地（Box3 已含 scale，勿再乘）
            inst.position.set(0, 0, 0);
            inst.updateMatrixWorld(true);
            const bx = new THREE.Box3().setFromObject(inst);
            inst.position.set(spot.x, -bx.min.y, spot.z);
            inst.rotation.y = Math.random() * Math.PI * 2;
            this.scene.add(inst);

            const mixer = new THREE.AnimationMixer(inst);
            const clip = animations.find(a => a.name === 'Walk')
              || animations.find(a => a.name === 'Idle')
              || animations[0];
            if (clip) mixer.clipAction(clip).play();
            this.mixers.push(mixer);

            this.animals.push({
              obj: inst,
              base: spot.clone(),
              phase: Math.random() * Math.PI * 2,
              speed: 1.6 + Math.random() * 1.4,
              wander: new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                0,
                (Math.random() - 0.5) * 2
              ),
              type: name,
              head: inst.getObjectByName('Head')
            });
          }
          loaded += 2;
          if (loaded === total) {
            console.log('🐾 骨骼动画动物加载成功 (' + this.animals.length + ' 只, 图鉴 ' + Object.keys(this.animalCatalog).length + ' 种)');
            this._reseatVillageAnimals();
          }
        },
        () => {},
        (error) => {
          console.error('❌ 动物加载失败 (' + name + '):', error);
          loaded += 2;
        }
      );
    });
  }

  // Quaternius 动物 PBR 在弱光下几乎发黑，像几何体；改成亮色 Lambert（独立材质，不污染模板）
  _prepareAnimalVisual(inst) {
    inst.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.frustumCulled = false;
      o.visible = true;
      o.castShadow = true;
      const srcList = Array.isArray(o.material) ? o.material : [o.material];
      const next = srcList.map(m => {
        if (!m) return new THREE.MeshLambertMaterial({ color: 0xccaa88 });
        const col = m.color ? m.color.clone() : new THREE.Color(0xccaa88);
        // 略提亮，保证草地对比
        col.r = Math.min(1, col.r * 1.25 + 0.05);
        col.g = Math.min(1, col.g * 1.25 + 0.05);
        col.b = Math.min(1, col.b * 1.25 + 0.05);
        return new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });
  }

  // 场景房屋多为合并网格：水平射线测墙，把动物推离建筑
  _collectColliders() {
    if (this._collideMeshes && this._collideMeshes.length) return this._collideMeshes;
    const list = [];
    this.scene.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      if (o.userData && o.userData.enemyMark) return;
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.8) return;
      if (size.x > 40 && size.z > 40) return;
      list.push(o);
    });
    this._collideMeshes = list;
    return list;
  }

  _wallClearance(x, z, need = 2.8) {
    const meshes = this._collectColliders();
    if (!meshes.length) return { ok: true, minD: need + 1, push: null };
    const origin = new THREE.Vector3(x, 1.35, z);
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
    ];
    let minD = need + 1;
    let push = null;
    const ray = new THREE.Raycaster();
    ray.far = Math.max(need + 1.5, 6);
    for (const [dx, dz] of dirs) {
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      ray.set(origin, dir);
      const hits = ray.intersectObjects(meshes, false);
      for (const h of hits) {
        if (h.face) {
          const nw = h.face.normal.clone().transformDirection(h.object.matrixWorld);
          if (Math.abs(nw.y) > 0.55) continue;
        }
        if (h.distance < minD) {
          minD = h.distance;
          push = dir.clone().multiplyScalar(-(need - h.distance));
        }
        break;
      }
    }
    return { ok: minD >= need, minD, push };
  }

  _inBuilding(x, z, margin = 0) {
    return !this._wallClearance(x, z, 3.6 + margin).ok;
  }

  _pushOutOfBuildings(pos, margin = 0.4) {
    for (let i = 0; i < 6; i++) {
      const r = this._wallClearance(pos.x, pos.z, 3.2 + margin);
      if (r.ok || !r.push) break;
      pos.x += r.push.x;
      pos.z += r.push.z;
    }
    const HALF = 18.5;
    if (Math.abs(pos.x) > HALF) pos.x = Math.sign(pos.x) * HALF;
    if (Math.abs(pos.z) > HALF) pos.z = Math.sign(pos.z) * HALF;
    return pos;
  }

  // 仅刷怪时用：把脚底推离墙；追击中不要每帧推，否则会抵消跟随
  _pushAnimalClear(obj, groundY) {
    if (!obj) return;
    this._pushOutOfBuildings(obj.position, 0.6);
    if (groundY != null) obj.position.y = groundY;
  }

  // 猎杀关：场内中央道、多排刷在玩家前方（大关卡不会全挤成一团秒杀）
  _huntSpawnSpots(n, eye) {
    const spots = [];
    const cols = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(n))));
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lane = col - (cols - 1) / 2;
      spots.push({
        x: THREE.MathUtils.clamp(eye.x + lane * 1.7, -4.5, 4.5),
        z: eye.z - 4.2 - row * 2.4,
        row
      });
    }
    return spots;
  }

  // 村庄动物只放在明确空地（南北/外侧牧场），不随机进房区
  _scatterSpots(n) {
    const pastures = [
      [0, 15], [3, 15.5], [-3, 15.5], [5, 14], [-5, 14],
      [0, -17], [4, -16.5], [-4, -16.5], [2, -15], [-2, -15],
      [15, 4], [15, -2], [14, 8], [-15, 4], [-15, -2], [-14, 8],
      [12, 12], [-12, 12], [10, -14], [-10, -14],
    ];
    const spots = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = pastures[i % pastures.length];
      const jitter = (i * 0.37) % 1;
      spots.push(new THREE.Vector3(
        x + (jitter - 0.5) * 1.2,
        0,
        z + ((i * 0.19) % 1 - 0.5) * 1.0
      ));
    }
    return spots;
  }

  // 场景晚于动物加载时：把家畜挪到牧场空地
  _reseatVillageAnimals() {
    if (!this.animals || !this.animals.length) return;
    this._collideMeshes = null;
    const pads = this._scatterSpots(this.animals.length);
    this.animals.forEach((a, i) => {
      if (!a.obj || !pads[i]) return;
      a.obj.position.x = pads[i].x;
      a.obj.position.z = pads[i].z;
      a.base = pads[i].clone();
    });
    console.log('🏠 村庄家畜已安置到牧场空地');
  }

  _setVillageAnimalsVisible(vis) {
    for (const a of this.animals || []) {
      if (a.obj) a.obj.visible = !!vis;
    }
  }

  // 加载真实骨骼动画人物（同源 girl 克隆；靠生活场景动画+站位+体型区分）
  loadCharacters() {
    this.characters = [];
    // 4 个生活场景：交谈 / 坐着休息 / 来回踱步 / 低头察看 —— 动画互不重复，拉开空间
    const girlFile = 'assets/characters/low_poly_girl.glb';
    const models = [
      {
        file: girlFile, role: 'chat', anim: 'cycle_talking',
        pos: [-9, -4], yaw: 0.55, scale: 1.0,
      },
      {
        file: girlFile, role: 'sit', anim: 'sit_idle',
        pos: [9, -3], yaw: -1.2, scale: 0.94,
      },
      {
        file: girlFile, role: 'pace', anim: 'walk',
        pos: [-4, -14], yaw: Math.PI * 0.5, scale: 1.06,
        // 沿 x 轴来回踱步（z 固定）
        patrol: { axis: 'x', min: -8, max: 2, speed: 1.15 },
      },
      {
        file: girlFile, role: 'inspect', anim: 'inspect_ground_loop',
        pos: [7, -16], yaw: Math.PI * 1.15, scale: 0.98,
      },
    ];
    const charLoader = new GLTFLoader();
    let charsReady = 0;
    const totalChars = models.length;

    models.forEach((m) => {
      charLoader.load(
        m.file,
        (gltf) => {
          // SkeletonUtils.clone：保留骨骼绑定（普通 clone 会断绑导致网格不渲染）
          const inst = skeletonClone(gltf.scene);
          this.scene.add(inst);
          inst.scale.setScalar(m.scale);
          // 脚底贴地（scale 变化后重新测包围盒）
          const b = new THREE.Box3().setFromObject(inst);
          const groundY = -b.min.y;
          inst.position.set(m.pos[0], groundY, m.pos[1]);
          inst.rotation.y = m.yaw;
          inst.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });

          const clips = gltf.animations || [];
          const mixer = new THREE.AnimationMixer(inst);
          const pick = m.anim;
          const clip = clips.find(a => a.name === pick)
            || clips.find(a => a.name === 'idle')
            || clips[0];
          if (clip) {
            const action = mixer.clipAction(clip);
            action.play();
            // 随机相位，避免同拍
            action.time = Math.random() * clip.duration;
          }

          const entry = {
            obj: inst,
            mixer,
            clips,
            currentClip: pick,
            role: m.role,
            groundY,
            patrol: m.patrol ? { ...m.patrol, dir: 1 } : null,
          };
          this.characters.push(entry);
          this.mixers.push(mixer);

          charsReady++;
          if (charsReady === totalChars) {
            const roles = this.characters.map(c => c.role + ':' + c.currentClip).join(', ');
            console.log('👤 人物加载成功 (' + this.characters.length + ' 人, 内嵌 ' + clips.length + ' 动画) [' + roles + ']');
            __fixAnimationBuffers();
          }
        },
        () => {},
        (error) => {
          console.error('❌ 人物加载失败 (' + m.file + '):', error);
          charsReady++;
        }
      );
    });
  }

  // ============== 游戏系统：关卡 / Boss / 战斗 ==============

  track(name, data) {
    const ev = { t: Date.now(), s: this._sessionId, e: name, level: this.levelIndex + 1, ...(data || {}) };
    this.analytics.events.push(ev);
    try {
      const key = this.SAVE_KEY + '_funnel';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      arr.push(ev);
      while (arr.length > 200) arr.shift();
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (_) {}
    if (location.search.includes('debug=1')) console.log('📊', name, data || '');
  }

  // 买量/变现埋点预留：接广告或内购时调用
  trackAdOpportunity(place) { this.track('ad_opportunity', { place: place || 'unknown' }); }
  trackPaywall(place) { this.track('paywall_shown', { place: place || 'unknown' }); }

  _loadSave() {
    try {
      return JSON.parse(localStorage.getItem(this.SAVE_KEY) || 'null');
    } catch (_) { return null; }
  }

  _saveProgress() {
    try {
      const prev = this._loadSave() || {};
      localStorage.setItem(this.SAVE_KEY, JSON.stringify({
        levelIndex: this.levelIndex,
        bestLevel: Math.max(prev.bestLevel || 0, this.levelIndex),
        updatedAt: Date.now()
      }));
    } catch (_) {}
  }

  _showTitle() {
    const el = document.getElementById('titleScreen');
    if (el) el.classList.remove('hidden');
    this._hideEnd();
    const cont = document.getElementById('btnContinue');
    const save = this._loadSave();
    if (cont) cont.style.display = (save && save.levelIndex > 0) ? '' : 'none';
  }

  _hideTitle() {
    const el = document.getElementById('titleScreen');
    if (el) el.classList.add('hidden');
  }

  _showEnd(kind) {
    const el = document.getElementById('endScreen');
    const title = document.getElementById('endTitle');
    const msg = document.getElementById('endMsg');
    if (!el) return;
    el.classList.remove('hidden');
    if (kind === 'dead') {
      if (title) title.textContent = '阵亡';
      if (msg) msg.textContent = '你倒在了第 ' + (this.levelIndex + 1) + ' 关。按「重试本关」继续，或「再来一局」从头挑战。';
      this.track('run_dead', { level: this.levelIndex + 1 });
      // 第 3 关后死亡：广告位机会点（尚未接 SDK）
      if (this.levelIndex >= 2) this.trackAdOpportunity('after_death_l3plus');
    } else {
      if (title) title.textContent = '通关！';
      if (msg) msg.textContent = '你拯救了村庄！谢谢游玩。欢迎再开一局，或把录像发到 itch。';
      this.track('run_victory');
      this.trackPaywall('after_victory');
    }
  }

  _hideEnd() {
    const el = document.getElementById('endScreen');
    if (el) el.classList.add('hidden');
  }

  toast(text, ms) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2800);
  }

  spawnFloatText(worldPos, text, kind) {
    const layer = document.getElementById('floatLayer');
    if (!layer || !this.camera) return;
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'dmgFloat' + (kind ? ' ' + kind : '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  _wireMetaUI() {
    const newBtn = document.getElementById('btnNewGame');
    const contBtn = document.getElementById('btnContinue');
    const retry = document.getElementById('btnRetry');
    const retryLv = document.getElementById('btnRetryLevel');
    const toTitle = document.getElementById('btnTitle');
    if (newBtn) newBtn.onclick = () => {
      this.awaitingStart = false;
      this._hideTitle();
      this.hp = this.maxHp;
      this.track('run_start', { mode: 'new' });
      this.startLevel(0);
    };
    if (contBtn) contBtn.onclick = () => {
      const save = this._loadSave();
      this.awaitingStart = false;
      this._hideTitle();
      this.hp = this.maxHp;
      const idx = save && save.levelIndex != null ? Math.min(save.levelIndex, this.levels.length - 1) : 0;
      this.track('run_start', { mode: 'continue', level: idx + 1 });
      this.startLevel(idx);
    };
    if (retry) retry.onclick = () => {
      this._hideEnd();
      this.hp = this.maxHp;
      this.track('run_retry_full');
      this.startLevel(0);
    };
    if (retryLv) retryLv.onclick = () => {
      this._hideEnd();
      this.hp = this.maxHp;
      this.track('run_retry_level', { level: this.levelIndex + 1 });
      this.startLevel(this.levelIndex);
    };
    if (toTitle) toTitle.onclick = () => {
      this._hideEnd();
      this.awaitingStart = true;
      this.gameState = 'playing';
      this.clearGameplay();
      this.updateHUD();
      this._showTitle();
    };
  }

  // 竖屏素材：自动演示约 15s（砍怪 → Boss → 结算感）?demo=1
  _startDemoReel() {
    this.toast('Demo 模式：可竖屏录屏约 15 秒', 2800);
    this.track('demo_start');
    clearInterval(this._demoTimer);
    clearTimeout(this._demoPhaseTimer);
    // 开场：猎杀关自动砍
    this._demoTimer = setInterval(() => {
      if (this.gameState !== 'playing') return;
      this.yaw += (Math.random() - 0.5) * 0.08;
      this.pitch = 0.18;
      this.applyRotation();
      this.eye.z += (Math.random() - 0.5) * 0.15;
      this.attack();
    }, 380);
    // ~6s 切 Boss 登场
    this._demoPhaseTimer = setTimeout(() => {
      this.toast('Boss 登场！', 2000);
      this.startLevel(4); // 第 5 关 Boss
      this.spawnProtect = 99;
    }, 6000);
    // ~12s 强制结算画面（录「通关反馈」）
    setTimeout(() => {
      clearInterval(this._demoTimer);
      this.toast('通关！村庄得救了', 2500);
      this.gameState = 'victory';
      this.levelIndex = this.levels.length - 1;
      this.updateHUD();
      this._showEnd('win');
      this.track('demo_end');
    }, 12000);
  }

  // 开始指定关卡
  startLevel(i) {
    this.levelIndex = i;
    const lv = this.levels[i];
    lv.progress = 0;
    this.gameState = 'playing';
    this.hp = this.maxHp;
    this.hitStop = 0;
    this.clearGameplay();
    this._hideEnd();

    // 猎杀时隐藏装饰家畜；Boss 战时也藏（spawnBoss 里再藏 NPC）
    this._setVillageAnimalsVisible(lv.type !== 'hunt' && lv.type !== 'boss');
    if (this.characters) {
      for (const c of this.characters) if (c.obj) c.obj.visible = (lv.type !== 'boss');
    }

    // 猎杀/Boss：场内南侧观察点（绿地上，不出界）；Boss 略远一点看全身
    if (lv.type === 'hunt' || lv.type === 'boss') {
      this.eye.set(lv.type === 'boss' ? -1.5 : 0, lv.type === 'boss' ? 3.2 : 3.0, lv.type === 'boss' ? 15 : 12);
      this.yaw = lv.type === 'boss' ? 0.12 : 0;
      this.pitch = lv.type === 'boss' ? 0.16 : 0.22;
      this.applyRotation();
    }

    // 开局短暂无敌，避免兽潮贴脸秒杀像“卡住”
    this.spawnProtect = (lv.type === 'hunt') ? 2.8 : (lv.type === 'boss' ? 1.5 : 0);

    if (lv.type === 'collect') {
      this.spawnPickups(lv.goal);
      this.audio && this.audio.levelStart && this.audio.levelStart();
    } else if (lv.type === 'hunt') {
      this.spawnEnemies(lv.goal, this.levelIndex);
      this.audio && this.audio.levelStart && this.audio.levelStart();
    } else if (lv.type === 'boss') {
      this.bossConfig = lv.boss || { name: '蛮荒领主', hp: 30, maxHp: 30, scale: 0.72, color: 0xa01818, dmg: 15, speed: 4.0, cd: 2.0, animal: 'Horse', style: 'warlord' };
      this.bossSpawned = true;
      this.spawnBoss(this.bossConfig);
      this.audio && this.audio.bossStart && this.audio.bossStart();
    }

    this._saveProgress();
    this.track('level_enter', { level: i + 1, type: lv.type });
    if (i === 0) this.toast('WASD 移动 · 鼠标转视角 · 点击/F/空格攻击', 3500);
    else if (lv.type === 'boss') this.toast((lv.boss && lv.boss.name ? lv.boss.name : 'Boss') + ' 登场！找准空档连砍', 2600);
    else if (lv.type === 'hunt' && this.spawnProtect > 0) this.toast('开局保护中 — 先站稳再冲', 2200);

    this.updateHUD();
    console.log('🗺️ 开始 ' + lv.name);
  }

  // 清空本关可玩对象
  clearGameplay() {
    this.spawnGen = (this.spawnGen || 0) + 1; // 作废进行中的异步刷怪
    this.bossGen = (this.bossGen || 0) + 1;
    // 水晶
    for (const o of this.pickups) {
      if (o.obj) {
        if (o.obj.userData) {
          if (o.obj.userData.light) this.scene.remove(o.obj.userData.light);
          if (o.obj.userData.beam) this.scene.remove(o.obj.userData.beam);
        }
        this.scene.remove(o.obj);
      }
    }
    this.pickups.length = 0;

    // 敌人：独立克隆体，直接移出场景
    for (const e of this.enemies) {
      if (!e.obj) continue;
      this._clearEnemyMark(e.obj);
      this.scene.remove(e.obj);
    }
    this.enemies.length = 0;

    if (this.boss) { if (this.boss.obj) this.scene.remove(this.boss.obj); this.boss = null; }
    this.bossSpawned = false;
    this.currentEnemies = 0;
  }

  // 生成能量水晶：固定刷在玩家前方村庄空地（可全找到），避免随机刷到身后/建筑里
  spawnPickups(n) {
    // 相对出生点偏北(-z) 的开阔点位，保证 n≤8 时全部可达可见
    const spots = [
      [-6, -3], [5, -4], [0, -7], [-10, -6],
      [9, -8], [-5, -11], [6, -12], [1, -15],
      [-12, -10], [12, -5], [-2, -18], [8, -16],
    ];
    for (let i = 0; i < n; i++) {
      const geo = new THREE.IcosahedronGeometry(0.45, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x33ddff, emissive: 0x22aaff, emissiveIntensity: 1.8,
        metalness: 0.25, roughness: 0.15
      });
      const m = new THREE.Mesh(geo, mat);
      const sp = spots[i % spots.length];
      // 轻微抖动避免重叠，仍保持在点位附近
      const x = sp[0] + (Math.random() - 0.5) * 0.6;
      const z = sp[1] + (Math.random() - 0.5) * 0.6;
      m.position.set(x, 1.35, z);
      const light = new THREE.PointLight(0x33ddff, 1.4, 10);
      light.position.copy(m.position);
      this.scene.add(light);
      m.userData.light = light;
      // 竖向光柱提示，远处也能看见
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.12, 3.5, 8),
        new THREE.MeshBasicMaterial({ color: 0x66eeff, transparent: true, opacity: 0.35 })
      );
      beam.position.set(x, 2.8, z);
      this.scene.add(beam);
      m.userData.beam = beam;
      this.scene.add(m);
      this.pickups.push({ obj: m, collected: false, phase: Math.random() * 6 });
    }
    console.log('💎 能量水晶已生成 (' + n + ' 个，均在村庄前方)');
  }

  // 给敌人加小红环/红标（不改动物材质；高度按包围盒）
  _addEnemyMark(inst) {
    const toDrop = [];
    inst.traverse(o => {
      if (o.userData && o.userData.enemyMark) toDrop.push(o);
    });
    toDrop.forEach(o => o.parent && o.parent.remove(o));

    inst.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inst);
    // mark 是子节点：用本地高度，避免再乘一遍 scale 把红标顶到天上
    const sy = Math.max(1e-4, inst.scale.y);
    const localH = Math.max(0.6, (box.max.y - inst.position.y) / sy);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.55, 24),
      new THREE.MeshBasicMaterial({ color: 0xff2200, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.userData.enemyMark = true;
    inst.add(ring);

    const mark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshBasicMaterial({ color: 0xff2200 })
    );
    mark.position.y = localH + 0.45;
    mark.userData.enemyMark = true;
    inst.add(mark);
  }

  _clearEnemyMark(inst) {
    if (!inst) return;
    const toDrop = [];
    inst.traverse(o => {
      if (o.userData && o.userData.enemyMark) toDrop.push(o);
    });
    toDrop.forEach(o => o.parent && o.parent.remove(o));
  }

  // 生成魔化野兽：从 animalCatalog 用 SkeletonUtils 克隆独立实例（不征用村庄家畜）
  spawnEnemies(n, levelIdx) {
    const names = Object.keys(this.animalCatalog || {});
    if (names.length === 0) {
      console.warn('⏳ 动物图鉴未就绪，稍后重试刷怪');
      const expected = this.levelIndex;
      setTimeout(() => {
        if (this.levelIndex !== expected) return;
        if (!this.levels[expected] || this.levels[expected].type !== 'hunt') return;
        if (this.enemies.length > 0) return;
        this.spawnEnemies(n, levelIdx);
      }, 250);
      return;
    }

    const enemyHp = Math.min(3 + Math.floor((levelIdx || 0) / 3), 7);
    this.spawnGen = (this.spawnGen || 0) + 1;
    const gen = this.spawnGen;
    const spots = this._huntSpawnSpots(n, this.eye);

    for (let i = 0; i < n; i++) {
      if (gen !== this.spawnGen) return;
      const name = names[i % names.length];
      const cat = this.animalCatalog[name];
      const inst = skeletonClone(cat.template);
      this._prepareAnimalVisual(inst);
      inst.scale.setScalar(0.45);

      const sp = spots[i];
      const x = sp.x;
      const z = sp.z;
      inst.position.set(0, 0, 0);
      inst.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(inst);
      const groundY = -bx.min.y;
      inst.position.set(x, groundY, z);
      // Quaternius 朝 +Z，面向玩家
      inst.rotation.y = Math.atan2(this.eye.x - x, this.eye.z - z);
      // 刷怪时轻推一次即可，追击中不再推

      this._addEnemyMark(inst);

      const mixer = new THREE.AnimationMixer(inst);
      const anims = cat.animations || [];
      const walk = anims.find(a => a.name === 'Walk')
        || anims.find(a => a.name === 'Idle')
        || anims[0];
      if (walk) mixer.clipAction(walk).play();

      this.scene.add(inst);
      this.enemies.push({
        obj: inst,
        mixer,
        hp: enemyHp,
        maxHp: enemyHp,
        type: name,
        phase: Math.random() * 6,
        attackCd: 0.8,
        groundY,
        chaseDelay: 0.5 + (sp.row || 0) * 0.55,
        reusedVillage: false
      });
      this.currentEnemies++;
    }

    this.updateHUD();
    console.log('🐺 魔化野兽出现 (' + n + ' 只, SkeletonUtils 真实动物) @玩家前方');
  }

  // 生成 Boss：巨型魔化动物（与猎杀关同套资产，避免丑裸模/粉球）
  // cfg = { name, hp, maxHp, scale, color, dmg, speed, cd, animal, style }
  spawnBoss(cfg) {
    cfg = cfg || this.bossConfig || {
      name: '蛮荒领主', hp: 30, maxHp: 30, scale: 0.72, color: 0xa01818, dmg: 15, speed: 4.0, cd: 2.0,
      animal: 'Horse', style: 'warlord'
    };
    this.bossConfig = cfg;
    this.bossGen = (this.bossGen || 0) + 1;
    const gen = this.bossGen;

    const trySpawn = (attempt) => {
      if (gen !== this.bossGen) return;
      const names = Object.keys(this.animalCatalog || {});
      const prefer = cfg.animal || 'Horse';
      const pickName = this.animalCatalog[prefer] ? prefer
        : (names.includes('Horse') ? 'Horse' : names[0]);
      if (!pickName) {
        if ((attempt || 0) < 40) setTimeout(() => trySpawn((attempt || 0) + 1), 200);
        else console.error('❌ Boss 动物图鉴未就绪');
        return;
      }
      const cat = this.animalCatalog[pickName];
      const inst = skeletonClone(cat.template);
      // 保留原贴图再魔化染色（不要走 _prepareAnimalVisual，否则会丢 map 变纯色块）
      this._tintBossAnimal(inst, cfg.color || 0xa01818, cfg.style || 'warlord');
      this.scene.add(inst);

      // 先按 1 倍测身高，再放大
      inst.scale.setScalar(1);
      inst.updateMatrixWorld(true);
      const rawBox = new THREE.Box3().setFromObject(inst);
      const rawH = Math.max(0.8, rawBox.max.y - rawBox.min.y);
      const scale = (cfg.scale != null) ? cfg.scale : 0.72;
      inst.scale.setScalar(scale);
      inst.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(inst);
      const groundY = -bx.min.y;
      // 玩家正前方偏右，避开中央树挡视野
      const spawnZ = this.eye.z - 7.2;
      inst.position.set(this.eye.x + 1.2, groundY, spawnZ);
      const face = this.eye.clone().sub(inst.position); face.y = 0;
      if (face.lengthSq() > 1e-4) inst.rotation.y = Math.atan2(face.x, face.z);

      this._addBossPresence(inst, cfg.color || 0xa01818, cfg.style || 'warlord', rawH);
      this._addBossArmor(inst, cfg.style || 'warlord', cfg.color || 0xa01818, rawH);

      const mixer = new THREE.AnimationMixer(inst);
      const clips = cat.animations || [];
      const findClip = (cands) => {
        for (const n of cands) {
          const c = clips.find(a => a.name === n || a.name.toLowerCase() === n.toLowerCase());
          if (c) return c;
        }
        return clips[0] || null;
      };
      const clipMap = {
        idle: findClip(['Idle', 'idle']),
        move: findClip(['Run', 'Walk', 'WalkSlow']),
        attack: findClip(['Jump', 'Run']),
        hit: findClip(['Idle']),
        death: findClip(['Death', 'Idle']),
      };

      const boss = {
        obj: inst, mixer, clips, clipMap,
        hp: cfg.hp, maxHp: cfg.maxHp, name: cfg.name,
        dmg: cfg.dmg || 15, speed: cfg.speed || 4.0, cd: cfg.cd || 2.0,
        attackCd: 0.8, phase: 0, style: cfg.style || 'warlord',
        anim: null, animName: '',
        attackLock: 0, hitFlash: 0, groundY,
        color: cfg.color || 0xa01818,
        animal: pickName,
      };
      this.boss = boss;
      this._bossPlay(boss, 'idle', { fade: 0 });
      // 登场停顿：先亮相再冲锋
      boss.attackLock = 1.1;
      boss.attackCd = 1.4;
      this._setVillageAnimalsVisible(false);
      if (this.characters) {
        for (const c of this.characters) if (c.obj) c.obj.visible = false;
      }
      this.updateHUD();
      console.log('👹 Boss「' + cfg.name + '」→ 魔化' + pickName + ' x' + scale);
    };
    trySpawn(0);
  }

  // 魔化染色：多材质分别染色，保留马身/蹄色差；深渊偏紫
  _tintBossAnimal(inst, hex, style) {
    const tint = new THREE.Color(hex);
    inst.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.frustumCulled = false;
      o.castShadow = true;
      o.visible = true;
      const srcList = Array.isArray(o.material) ? o.material : [o.material];
      const next = srcList.map((m, idx) => {
        const base = (m && m.color) ? m.color.clone() : new THREE.Color(0xbbbbbb);
        // 提亮保证可读
        base.r = Math.min(1, base.r * 1.35 + 0.05);
        base.g = Math.min(1, base.g * 1.3 + 0.04);
        base.b = Math.min(1, base.b * 1.3 + 0.04);
        // 主材质染主题色，次材质（蹄/条纹）染得更深
        const mix = (idx === 0)
          ? (style === 'abyss' ? 0.4 : 0.35)
          : (style === 'abyss' ? 0.55 : 0.5);
        base.lerp(tint, mix);
        if (idx > 0) base.multiplyScalar(0.55);
        return new THREE.MeshLambertMaterial({
          color: base,
          map: m && m.map ? m.map : null,
          side: THREE.DoubleSide,
        });
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });
  }

  // 简易装甲/魔角：warlord 金角 / abyss 魔晶 / end 三红角+双层甲
  _addBossArmor(inst, style, hex, localH) {
    const col = new THREE.Color(hex);
    const dark = col.clone().multiplyScalar(0.4);
    const h = Math.min(2.4, Math.max(1.0, localH || 2));
    const isEnd = style === 'end';

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(isEnd ? 0.55 : 0.42, isEnd ? 0.2 : 0.16, isEnd ? 0.7 : 0.55),
      new THREE.MeshLambertMaterial({ color: dark })
    );
    plate.position.set(0, h * 0.48, -0.08);
    plate.userData.bossFx = true;
    inst.add(plate);

    if (isEnd) {
      const plate2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.12, 0.5),
        new THREE.MeshLambertMaterial({ color: dark.clone().multiplyScalar(0.7) })
      );
      plate2.position.set(0, h * 0.38, 0.12);
      plate2.userData.bossFx = true;
      inst.add(plate2);
    }

    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(isEnd ? 0.16 : 0.12, isEnd ? 0.18 : 0.14, isEnd ? 0.6 : 0.48),
      new THREE.MeshBasicMaterial({ color: isEnd ? 0xff2200 : col })
    );
    ridge.position.set(0, h * 0.56, -0.08);
    ridge.userData.bossFx = true;
    inst.add(ridge);

    const head = inst.getObjectByName('Head');
    if (head && (style === 'warlord' || isEnd)) {
      const hornColor = isEnd ? 0xff2200 : 0xffd27a;
      const sides = isEnd ? [-1, 0, 1] : [-1, 1];
      for (const side of sides) {
        const horn = new THREE.Mesh(
          new THREE.ConeGeometry(isEnd ? 0.06 : 0.05, isEnd ? 0.4 : 0.32, 6),
          new THREE.MeshBasicMaterial({ color: hornColor })
        );
        horn.position.set(side * 0.12, 0.12 + (side === 0 ? 0.08 : 0), 0.18);
        horn.rotation.x = side === 0 ? -1.05 : -0.9;
        horn.rotation.z = side * 0.2;
        horn.userData.bossFx = true;
        head.add(horn);
      }
    }
    if (head && style === 'abyss') {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.14, 0),
        new THREE.MeshBasicMaterial({ color: 0xcc99ff })
      );
      crystal.position.set(0, 0.22, 0.1);
      crystal.userData.bossFx = true;
      crystal.userData.bossCrest = true;
      crystal.userData.crestBase = 0.22;
      head.add(crystal);
    }
  }

  // 脚下光环 + 头顶魔晶 + 环绕球（end 双环更醒目）
  _addBossPresence(inst, hex, style, localH) {
    const col = new THREE.Color(hex);
    const h = Math.min(3.2, Math.max(1.2, localH || 2.0));
    const isEnd = style === 'end';
    const isAbyss = style === 'abyss';

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(isEnd ? 0.7 : 0.55, isEnd ? 1.15 : 0.95, 48),
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.userData.bossFx = true;
    inst.add(ring);

    if (isEnd) {
      const ring2 = new THREE.Mesh(
        new THREE.RingGeometry(1.25, 1.45, 48),
        new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
      );
      ring2.rotation.x = -Math.PI / 2;
      ring2.position.y = 0.05;
      ring2.userData.bossFx = true;
      inst.add(ring2);
    }

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(isEnd ? 0.65 : 0.5, 32),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.03;
    disc.userData.bossFx = true;
    inst.add(disc);

    const crest = new THREE.Mesh(
      new THREE.OctahedronGeometry(isEnd ? 0.28 : 0.22, 0),
      new THREE.MeshBasicMaterial({ color: isEnd ? 0xff3300 : col, transparent: true, opacity: 0.95 })
    );
    crest.position.y = h + 0.35;
    crest.userData.bossFx = true;
    crest.userData.bossCrest = true;
    crest.userData.crestBase = h + 0.35;
    inst.add(crest);

    const nOrbs = isAbyss ? 4 : (isEnd ? 5 : 2);
    for (let i = 0; i < nOrbs; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(isAbyss ? 0.11 : (isEnd ? 0.1 : 0.09), 10, 10),
        new THREE.MeshBasicMaterial({ color: isAbyss ? 0xb48cff : (isEnd ? 0xff5533 : col) })
      );
      orb.userData.bossFx = true;
      orb.userData.bossOrb = true;
      orb.userData.orbPhase = i * (Math.PI * 2 / nOrbs);
      orb.userData.orbR = isAbyss ? 0.95 : (isEnd ? 1.05 : 0.8);
      orb.userData.orbY = h * 0.42;
      inst.add(orb);
    }

    const light = new THREE.PointLight(hex, isAbyss ? 3.2 : (isEnd ? 3.8 : 2.6), isEnd ? 20 : 16);
    light.position.set(0, h * 0.55, 0);
    light.userData.bossFx = true;
    inst.add(light);
  }

  _bossPlay(b, key, opts) {
    opts = opts || {};
    const clip = b.clipMap && b.clipMap[key];
    if (!clip || !b.mixer) return null;
    if (b.animName === key && !opts.force) return b.anim;
    const next = b.mixer.clipAction(clip);
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, opts.once ? 1 : Infinity);
    next.clampWhenFinished = !!opts.once;
    next.timeScale = opts.timeScale || (key === 'move' ? 1.15 : 1);
    const fade = opts.fade == null ? 0.15 : opts.fade;
    if (b.anim && b.anim !== next && fade > 0) {
      b.anim.crossFadeTo(next, fade, false);
    }
    next.enabled = true;
    next.play();
    b.anim = next;
    b.animName = key;
    return next;
  }

  _updateBossFx(b, time, delta) {
    if (!b.obj) return;
    b.obj.traverse(o => {
      if (o.userData && o.userData.bossCrest) {
        o.rotation.y += delta * 2.4;
        const base = o.userData.crestBase || 2.2;
        o.position.y = base + Math.sin(time * 3.2) * 0.1;
      }
      if (o.userData && o.userData.bossOrb) {
        const ph = o.userData.orbPhase + time * 2.6;
        const r = o.userData.orbR || 1.2;
        const y0 = o.userData.orbY || 1.0;
        o.position.set(Math.cos(ph) * r, y0 + Math.sin(ph * 1.8) * 0.28, Math.sin(ph) * r);
      }
    });
  }

  // 玩家攻击：前方扇形范围命中敌人/Boss，播放音效
  attack() {
    if (this.awaitingStart) return;
    if (this.gameState !== 'playing') return;
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 0.35;
    this.audio && this.audio.swing && this.audio.swing();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const RANGE = 4.5, DOT = 0.5;
    let hitAny = false;

    // 普通敌人
    for (const e of this.enemies) {
      if (e.hp <= 0 || !e.obj) continue;
      const d = e.obj.position.clone().sub(this.eye); d.y = 0;
      const dist = d.length();
      // 贴身时零向量无法 normalize，视为必中；否则扇形判定
      const inMelee = dist < 1.6;
      const inCone = dist < RANGE && dist > 1e-4 && d.normalize().dot(fwd) > DOT;
      if (inMelee || inCone) {
        e.hp -= 1;
        hitAny = true;
        this.hitStop = Math.max(this.hitStop, 0.07);
        this.spawnFloatText(e.obj.position.clone().add(new THREE.Vector3(0, 1.2, 0)), '-1', 'hit');
        // 击退（贴身也略推开，避免卡模型里）
        e.obj.position.add(fwd.clone().multiplyScalar(1.2));
        const HALF = 18.5;
        e.obj.position.x = THREE.MathUtils.clamp(e.obj.position.x, -HALF, HALF);
        e.obj.position.z = THREE.MathUtils.clamp(e.obj.position.z, -HALF, HALF);
        if (e.hp <= 0) {
          this.audio && this.audio.enemyDown && this.audio.enemyDown();
          this.hitStop = Math.max(this.hitStop, 0.12);
          this.spawnFloatText(e.obj.position.clone().add(new THREE.Vector3(0, 1.6, 0)), '击杀!', 'kill');
          this.levels[this.levelIndex].progress++;
          this.updateHUD();
          if (e.obj) this.scene.remove(e.obj);
          e.obj = null;
          console.log('💥 击杀 ' + e.type);
          const lv = this.levels[this.levelIndex];
          if (lv.type === 'hunt' && lv.progress >= lv.goal) this.nextLevel();
        } else {
          this.audio && this.audio.hit && this.audio.hit();
        }
      }
    }

    // Boss
    if (this.boss && this.boss.hp > 0 && this.boss.obj) {
      const d = this.boss.obj.position.clone().sub(this.eye); d.y = 0;
      const dist = d.length();
      if (dist < RANGE + 3.2 && (dist < 2.4 || d.normalize().dot(fwd) > DOT * 0.85)) {
        this.boss.hp -= 1;
        hitAny = true;
        this.hitStop = Math.max(this.hitStop, 0.09);
        const floatY = this.boss.obj.position.clone().add(new THREE.Vector3(0, 2.8, 0));
        this.spawnFloatText(floatY, '-1', 'hit');
        this.audio && this.audio.hit && this.audio.hit();
        // 轻击退
        const knock = fwd.clone().multiplyScalar(0.55);
        this.boss.obj.position.add(knock);
        if ((this.boss.attackLock || 0) < 0.15) {
          this.boss.hitFlash = 0.22;
        }
        this.updateHUD();
        if (this.boss.hp / this.boss.maxHp < 0.5 && !this.boss._raged) {
          this.boss._raged = true;
          this.boss.speed = (this.boss.speed || 4.0) * 1.3;
          this.boss.cd = Math.max(1.0, (this.boss.cd || 2.0) * 0.7);
          this.toast('Boss 狂暴了！', 2200);
          this._bossPlay(this.boss, 'move', { force: true, timeScale: 1.35 });
        }
        if (this.boss.hp <= 0) {
          this.audio && this.audio.victory && this.audio.victory();
          this.hitStop = Math.max(this.hitStop, 0.18);
          this.spawnFloatText(this.boss.obj.position.clone().add(new THREE.Vector3(0, 3.0, 0)), '击败!', 'kill');
          this.levels[this.levelIndex].progress = this.levels[this.levelIndex].goal;
          this.track('level_clear', { level: this.levelIndex + 1, type: 'boss' });
          this.boss.attackLock = 2;
          this._bossPlay(this.boss, 'death', { force: true, once: true, fade: 0.08 });
          const deadBoss = this.boss;
          const finish = () => {
            if (deadBoss.obj) this.scene.remove(deadBoss.obj);
            if (this.boss === deadBoss) this.boss = null;
            this.updateHUD();
            if (this.levelIndex + 1 >= this.levels.length) {
              this.gameState = 'victory';
              this._saveProgress();
              this._showEnd('win');
            } else {
              this.toast('Boss 倒下！进入下一关', 1600);
              setTimeout(() => this.startLevel(this.levelIndex + 1), 1400);
            }
          };
          setTimeout(finish, 1200);
        }
      }
    }
    if (!hitAny) this.audio && this.audio.whiff && this.audio.whiff();
  }

  // 每帧游戏逻辑：收集/敌人 AI/Boss AI/受击/胜负
  updateGameplay(time, delta) {
    if (this.awaitingStart) return;
    // Boss 战持续藏 NPC（人物可能比 Boss 晚加载）
    if (this.boss && this.boss.hp > 0 && this.characters) {
      for (const c of this.characters) if (c.obj && c.obj.visible) c.obj.visible = false;
    }
    // 命中停顿：短暂停战斗/AI，保留渲染与音效反馈
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - delta);
      this.attackCooldown = Math.max(0, this.attackCooldown - delta);
      return;
    }
    // 冷却与 AI 不依赖音频解锁（否则第二关野兽原地不动 / 看不见追击）
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    const prevProtect = this.spawnProtect || 0;
    this.spawnProtect = Math.max(0, prevProtect - delta);
    if (prevProtect > 0 && this.spawnProtect <= 0) this.updateHUD();
    if (this.gameState !== 'playing') return;
    const lv = this.levels[this.levelIndex];
    const sfx = (fn) => { if (this.audio && this.audio.ctx && this.audio[fn]) this.audio[fn](); };

    // 收集水晶
    if (lv.type === 'collect') {
      for (const p of this.pickups) {
        if (p.collected) continue;
        p.obj.rotation.y += delta * 2;
        p.obj.position.y = 1.0 + Math.sin(time * 2 + p.phase) * 0.2;
        const d = p.obj.position.clone().sub(this.eye); d.y = 0;
        if (d.length() < 1.8) {
          p.collected = true;
          this.scene.remove(p.obj);
          if (p.obj.userData.light) this.scene.remove(p.obj.userData.light);
          if (p.obj.userData.beam) this.scene.remove(p.obj.userData.beam);
          lv.progress++;
          sfx('pickup');
          this.spawnFloatText(p.obj.position.clone().add(new THREE.Vector3(0, 1.1, 0)), '+1', 'heal');
          this.updateHUD();
          if (lv.progress >= lv.goal) this.nextLevel();
        }
      }
    }

    // 敌人 AI：追踪玩家；同帧最多 2 只近战，避免兽潮贴脸秒杀
    const meleeHits = [];
    for (const e of this.enemies) {
      if (e.hp <= 0 || !e.obj) continue;
      if (e.mixer) e.mixer.update(delta);
      if (e.chaseDelay > 0) {
        e.chaseDelay -= delta;
        continue;
      }
      const toP = this.eye.clone().sub(e.obj.position); toP.y = 0;
      const dist = toP.length();
      if (dist > 1.5) {
        toP.normalize();
        e.obj.position.add(toP.multiplyScalar(4.2 * delta));
        e.obj.rotation.y = Math.atan2(toP.x, toP.z);
        if (e.groundY != null) e.obj.position.y = e.groundY;
        const HALF = 18.5;
        e.obj.position.x = THREE.MathUtils.clamp(e.obj.position.x, -HALF, HALF);
        e.obj.position.z = THREE.MathUtils.clamp(e.obj.position.z, -HALF, HALF);
      }
      e.attackCd = Math.max(0, (e.attackCd || 0) - delta);
      if (dist < 2.2 && e.attackCd <= 0) meleeHits.push({ e, dist });
    }
    meleeHits.sort((a, b) => a.dist - b.dist);
    // 同时最多 1 只造成伤害，兽潮关可操作
    if (meleeHits.length) {
      const { e } = meleeHits[0];
      e.attackCd = 1.5;
      this.damagePlayer(5, '野兽');
    }

    // Boss AI：追击用慢跑、近身剑击/法术，动作交叉淡入
    if (this.boss && this.boss.hp > 0 && this.boss.obj) {
      const b = this.boss;
      if (b.mixer) b.mixer.update(delta);
      this._updateBossFx(b, time, delta);
      b.attackLock = Math.max(0, (b.attackLock || 0) - delta);
      b.hitFlash = Math.max(0, (b.hitFlash || 0) - delta);
      b.attackCd = Math.max(0, b.attackCd - delta);

      const toP = this.eye.clone().sub(b.obj.position); toP.y = 0;
      const dist = toP.length();
      const bSpeed = (b.speed || 3.2) * (b._raged ? 1.25 : 1);
      const bCd = b.cd || 2.2;
      const bDmg = b.dmg || 15;
      const bName = b.name || 'Boss';

      if (b.hitFlash <= 0 && b.attackLock <= 0) {
        if (dist > 4.0) {
          toP.normalize();
          b.obj.position.add(toP.multiplyScalar(bSpeed * delta));
          b.obj.rotation.y = Math.atan2(toP.x, toP.z);
          if (b.groundY != null) b.obj.position.y = b.groundY;
          const HALF = 18.5;
          b.obj.position.x = THREE.MathUtils.clamp(b.obj.position.x, -HALF, HALF);
          b.obj.position.z = THREE.MathUtils.clamp(b.obj.position.z, -HALF, HALF);
          this._bossPlay(b, 'move');
        } else {
          if (dist > 0.2) {
            toP.normalize();
            b.obj.rotation.y = Math.atan2(toP.x, toP.z);
          }
          this._bossPlay(b, 'idle');
          if (b.attackCd <= 0) {
            b.attackCd = bCd;
            const atkClip = b.clipMap && b.clipMap.attack;
            const lock = atkClip ? Math.min(1.25, Math.max(0.7, atkClip.duration * 0.9)) : 0.85;
            b.attackLock = lock;
            this._bossPlay(b, 'attack', { force: true, once: true, fade: 0.08, timeScale: 1.2 });
            // 扑击前冲一小段
            const lunge = toP.lengthSq() > 1e-4 ? toP.clone().normalize() : new THREE.Vector3(0, 0, 1);
            b.obj.position.add(lunge.multiplyScalar(1.1));
            if (b.groundY != null) b.obj.position.y = b.groundY;
            const dmgDelay = Math.min(0.4, lock * 0.4);
            const bossRef = b;
            setTimeout(() => {
              if (this.boss !== bossRef || bossRef.hp <= 0 || this.gameState !== 'playing') return;
              const d2 = this.eye.distanceTo(bossRef.obj.position);
              if (d2 < 6.5) this.damagePlayer(bDmg, bName);
            }, dmgDelay * 1000);
          }
        }
      }
    } else if (this.boss && this.boss.hp <= 0 && this.boss.obj && this.boss.mixer) {
      this.boss.mixer.update(delta);
      this._updateBossFx(this.boss, time, delta);
    }
  }

  // 玩家受击
  damagePlayer(amount, who) {
    if (this.gameState !== 'playing') return;
    if ((this.spawnProtect || 0) > 0) return;
    this.hp -= amount;
    this.audio && this.audio.hurt && this.audio.hurt();
    this.spawnFloatText(this.eye.clone().add(new THREE.Vector3(0, 0.5, 0)), '-' + amount, 'hit');
    this.updateHUD();
    if (this.hp <= 0) {
      this.hp = 0;
      this.gameState = 'dead';
      this.audio && this.audio.defeat && this.audio.defeat();
      this.track('level_fail', { level: this.levelIndex + 1, who: who || '' });
      this.updateHUD();
      this._showEnd('dead');
      console.log('💀 你被 ' + who + ' 击败了');
    }
  }

  // 通关进入下一关
  nextLevel() {
    const cleared = this.levelIndex + 1;
    this.track('level_clear', { level: cleared });
    // 漏斗关键节点：第 1 / 3 关
    if (cleared === 1) this.track('funnel_clear_l1');
    if (cleared === 3) this.track('funnel_clear_l3');
    this.audio && this.audio.levelClear && this.audio.levelClear();
    if (this.levelIndex + 1 >= this.levels.length) {
      this.gameState = 'victory';
      this._saveProgress();
      this.updateHUD();
      this._showEnd('win');
      console.log('🏆 全部通关!');
      return;
    }
    this.gameState = 'victory';
    this.toast('关卡完成！', 1400);
    this.updateHUD();
    const next = this.levelIndex + 1;
    setTimeout(() => {
      if (this.gameState !== 'victory') return;
      this.startLevel(next);
    }, 1200);
  }

  // 更新 HUD
  updateHUD() {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const lv = this.levels[this.levelIndex];
    let msg = '';
    if (this.awaitingStart) msg = '点击「开始冒险」进入';
    else if (this.gameState === 'dead') msg = '阵亡 — 选重试或按 R';
    else if (this.gameState === 'victory') {
      const lastBoss = this.bossConfig && this.bossConfig.name ? this.bossConfig.name : '敌人';
      msg = (this.levelIndex + 1 >= this.levels.length)
        ? '通关！你击败了' + lastBoss
        : '关卡完成！';
    }
    else if (this.gameState === 'playing') msg = lv.hint;
    const protect = (this.spawnProtect || 0) > 0
      ? '<div class="protect">开局保护 ' + this.spawnProtect.toFixed(1) + 's</div>'
      : '';
    hud.innerHTML = '' +
      '<div class="brand">村庄大冒险</div>' +
      '<div class="hpbar"><div class="hpfill" style="width:' + (Math.max(0, this.hp) / this.maxHp * 100) + '%"></div></div>' +
      '<div class="hudrow"><strong>第 ' + (this.levelIndex + 1) + ' 关</strong> · ' + lv.name.replace(/^关卡\d+\s*·\s*/, '') + '</div>' +
      '<div class="hudrow">' + msg + '</div>' +
      protect +
      (this.boss && this.boss.hp > 0 && lv.type === 'boss'
        ? '<div class="bossbar"><div class="bossfill" style="width:' + (this.boss.hp / this.boss.maxHp * 100) + '%"></div></div><div class="hudrow">' + (this.boss.name || 'Boss') + ' HP</div>'
        : '') +
      '<div class="hudrow">进度: ' + lv.progress + ' / ' + lv.goal + '</div>';
    const hint = document.getElementById('hint');
    if (hint) {
      if (this.awaitingStart) hint.innerHTML = '💡 点击「开始冒险」后进入游戏';
      else if (this.gameState === 'playing') hint.innerHTML = '💡 目标: ' + lv.hint;
      else if (this.gameState === 'dead') hint.innerHTML = '💡 重试本关，或按 R 再来一局';
      else if (this.gameState === 'victory') hint.innerHTML = '💡 通关结算 — 可再来一局';
    }
  }

  // 播放骨骼动画 + 轻微待机摆动
  animateAnimals(time, delta) {
    if (!this.animals) return;
    // 推进动画混合器
    for (const m of this.mixers) m.update(delta);
    // 轻微待机摆动（叠加在骨骼动画上，增加生命力）
    for (const a of this.animals) {
      const t = time * 0.6 + a.phase;
      a.obj.rotation.z = Math.sin(t) * 0.02;
      a.obj.rotation.x = Math.sin(t * 0.7) * 0.015;
    }
  }

  // 推进人物 NPC 动画；踱步角色沿 patrol 线段来回走并朝向前进方向
  animateCharacters(time, delta) {
    if (!this.characters) return;
    for (const c of this.characters) {
      if (c.mixer) c.mixer.update(delta);
      if (!c.patrol || !c.obj) continue;
      const p = c.patrol;
      const axis = p.axis === 'z' ? 'z' : 'x';
      let v = c.obj.position[axis] + p.dir * p.speed * delta;
      if (v >= p.max) { v = p.max; p.dir = -1; }
      else if (v <= p.min) { v = p.min; p.dir = 1; }
      c.obj.position[axis] = v;
      c.obj.position.y = c.groundY;
      // walk 默认朝 -Z；绕 Y 转到沿 axis 的前进方向
      if (axis === 'x') c.obj.rotation.y = p.dir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      else c.obj.rotation.y = p.dir > 0 ? 0 : Math.PI;
    }
  }

  // 检测玩家与 NPC 的距离，靠近时播放提示音（带冷却，避免刷屏）
  updateProximity(time) {
    if (!this.audio || !this.characters || !this.audio.ctx) return;
    if (this.audio.proximityCooldown > time) return;
    for (const c of this.characters) {
      const dx = c.obj.position.x - this.eye.x;
      const dz = c.obj.position.z - this.eye.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 4) {
        this.audio.chime();
        this.audio.proximityCooldown = time + 6;
        break;
      }
    }
  }

  // 根据 yaw/pitch 更新相机朝向（平视优先）
  applyRotation() {
    const limit = this.pitchLimit || 0.55;
    const pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
    this.pitch = pitch;
    const radius = 1;
    this.camera.position.x = this.eye.x + radius * Math.cos(pitch) * Math.sin(this.yaw);
    this.camera.position.y = this.eye.y + radius * Math.sin(pitch);
    this.camera.position.z = this.eye.z + radius * Math.cos(pitch) * Math.cos(this.yaw);
    this.camera.lookAt(this.eye);
  }

  setupInput() {
    // 鼠标左键拖拽旋转（触控板/鼠标通用）
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        // 没有明显拖拽则视为攻击（点按）
        const dx = Math.abs(e.clientX - (this.lastPointer ? this.lastPointer.x : e.clientX));
        const dy = Math.abs(e.clientY - (this.lastPointer ? this.lastPointer.y : e.clientY));
        if (this.isDragging && dx < 6 && dy < 6) this.attack();
        this.isDragging = false;
      }
    });
    window.addEventListener('pointermove', (e) => {
      const yawS = this.yawSens || 0.005;
      const pitchS = this.pitchSens || 0.002;
      const limit = this.pitchLimit || 0.55;
      // 指针锁定模式：鼠标移动直接转视角（FPS 手感，无需拖拽）
      if (this.pointerLocked) {
        this.yaw -= e.movementX * yawS;
        this.pitch -= e.movementY * pitchS;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
        this.applyRotation();
        return;
      }
      if (this.isDragging) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.yaw -= dx * yawS;
        this.pitch -= dy * pitchS;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.applyRotation();
      }
    });
    // 点击画面进入指针锁定（FPS 模式），Esc 退出
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.pointerLocked && this.renderer.domElement.requestPointerLock) {
        try { this.renderer.domElement.requestPointerLock(); } catch(e) {}
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = (document.pointerLockElement === this.renderer.domElement);
      const hint = document.getElementById('hint');
      if (hint) hint.textContent = this.pointerLocked ? '🔒 指针锁定中 — 鼠标移动转视角, Esc 退出' : '💡 点击画面锁定鼠标，移动鼠标转视角，WASD 移动';
    });

    // ===== 触屏虚拟控制（手机/平板） =====
    if (this._isTouchDevice()) {
      this.touchVector = { x: 0, y: 0 };  // 摇杆方向（x=左右, y=前后）
      this._setupTouchControls();
    }
    // 触屏拖动右侧画面 = 转视角
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this._isTouchDevice()) {
        const t = e.touches[0];
        // 若触摸在摇杆区内则交给摇杆处理，否则转视角
        if (this.isDragging) {
          const dx = t.clientX - this.lastPointer.x;
          const dy = t.clientY - this.lastPointer.y;
          this.yaw -= dx * 0.006;
          this.pitch -= dy * 0.0024;
          this.pitch = THREE.MathUtils.clamp(this.pitch, -(this.pitchLimit || 0.55), this.pitchLimit || 0.55);
          this.lastPointer = { x: t.clientX, y: t.clientY };
          this.applyRotation();
        }
      }
    }, { passive: true });
    window.addEventListener('touchstart', (e) => {
      if (!this._isTouchDevice()) return;
      const t = e.touches[0];
      const x = t.clientX / window.innerWidth;
      // 右侧 55% 区域触摸 = 开始转视角
      if (x > 0.55 && !this._inJoyZone(t.clientX, t.clientY)) {
        this.isDragging = true;
        this.lastPointer = { x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    window.addEventListener('touchend', () => { this.isDragging = false; });
    // 滚轮缩放（调整眼睛高度）
    window.addEventListener('wheel', (e) => {
      this.eye.y += e.deltaY * 0.01;
      this.eye.y = THREE.MathUtils.clamp(this.eye.y, 1.6, 8);
      this.applyRotation();
    });

    // 键盘
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      // 攻击：F 键 / 空格
      if ((e.code === 'KeyF' || e.code === 'Space') && !this.awaitingStart) this.attack();
      // R：阵亡 → 重试本关；全通关 → 再来一局
      if (e.code === 'KeyR') {
        if (this.gameState === 'dead') {
          this._hideEnd();
          this.track('run_retry_level', { level: this.levelIndex + 1, via: 'key' });
          this.startLevel(this.levelIndex);
        } else if (this.gameState === 'victory' && this.levelIndex + 1 >= this.levels.length) {
          this._hideEnd();
          this.track('run_retry_full', { via: 'key' });
          this.startLevel(0);
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
    });
  }

  updateMovement(delta) {
    const speed = this.moveSpeed * (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 3 : 1);
    this.moveVector.set(0, 0, 0);

    // 基于当前 yaw 计算前进方向（水平面）
    // 注意：相机位于 eye 前方沿 yaw 方向、看向 eye，
    // 所以视线（前进）方向是 (-sin(yaw), 0, -cos(yaw))
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.keys['KeyW'] || this.keys['ArrowUp']) this.moveVector.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) this.moveVector.sub(forward);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this.moveVector.add(right);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.moveVector.sub(right);

    // 空格只用于攻击（keydown → attack），不再抬升镜头
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) this.moveVector.y -= 1;

    // 触屏虚拟摇杆输入
    if (this.touchVector && (this.touchVector.x !== 0 || this.touchVector.y !== 0)) {
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.moveVector.addScaledVector(f, this.touchVector.y);  // y=前后
      this.moveVector.addScaledVector(r, this.touchVector.x);  // x=左右
    }

    // 键盘转向 Q/E（适合触控板用户无需拖拽即可转视角）
    if (this.keys['KeyQ']) this.yaw += this.turnSpeed * delta;
    if (this.keys['KeyE']) this.yaw -= this.turnSpeed * delta;
    if (this.keys['KeyQ'] || this.keys['KeyE']) this.applyRotation();

    if (this.moveVector.length() > 0) {
      this.moveVector.normalize().multiplyScalar(speed * delta);
      this.eye.add(this.moveVector);
      // 地面限制：保持头高区间，避免飞太高导致看不见地面单位
      if (this.eye.y < 1.6) this.eye.y = 1.6;
      if (this.eye.y > 8) this.eye.y = 8;
      // 场景边界限制（地形 40x40m，中心在原点 → x/z 范围 ±20）
      const HALF = 19.0; // 留 1m 缓冲，防止贴边
      if (this.eye.x < -HALF) this.eye.x = -HALF;
      if (this.eye.x > HALF) this.eye.x = HALF;
      if (this.eye.z < -HALF) this.eye.z = -HALF;
      if (this.eye.z > HALF) this.eye.z = HALF;
      this.applyRotation();
      // 脚步音：按移动节奏间隔播放
      if (this.audio && this.audio.ctx) {
        const now = performance.now() / 1000;
        if (now - this.lastStepTime > 0.35) {
          this.audio.step();
          this.lastStepTime = now;
        }
      }
    }
  }

  // ===== 触屏虚拟控制逻辑 =====
  _isTouchDevice() {
    // 触屏能力 + 窄屏（手机/平板）都判定为触控设备
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || coarse || window.innerWidth < 820;
  }

  _inJoyZone(px, py) {
    // 摇杆基准球在屏幕左下角 (30,40) 半径约 90px
    const rect = { x: 30 + 60, y: window.innerHeight - 40 - 60 + 60 };
    const bx = 30 + 60;
    const by = window.innerHeight - 40 - 60;
    const dx = px - bx, dy = py - by;
    return Math.sqrt(dx * dx + dy * dy) < 100;
  }

  _setupTouchControls() {
    const joyBase = document.getElementById('joyBase');
    const joyStick = document.getElementById('joyStick');
    const attackBtn = document.getElementById('attackBtn');
    // 强制显示触摸 UI、隐藏桌面操作说明（不依赖 pointer:coarse 媒体查询）
    const ui = document.getElementById('touchUI');
    if (ui) ui.style.display = 'block';
    const info = document.getElementById('info');
    if (info) info.style.display = 'none';
    if (!joyBase || !attackBtn) return;

    let active = false;
    const handleMove = (e) => {
      const t = e.touches[0] || (e.clientX !== undefined ? e : null);
      if (!t) return;
      const rect = joyBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const maxR = rect.width / 2;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxR) { dx = dx / len * maxR; dy = dy / len * maxR; }
      if (joyStick) joyStick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      // x=横向左右, y=纵向(上=前进)
      this.touchVector.x = dx / maxR;
      this.touchVector.y = -dy / maxR;
    };
    const reset = () => {
      active = false;
      this.touchVector.x = 0; this.touchVector.y = 0;
      if (joyStick) joyStick.style.transform = 'translate(0,0)';
    };

    joyBase.addEventListener('touchstart', (e) => { active = true; handleMove(e); e.preventDefault(); }, { passive: false });
    joyBase.addEventListener('touchmove', (e) => { if (active) handleMove(e); e.preventDefault(); }, { passive: false });
    joyBase.addEventListener('touchend', reset);
    joyBase.addEventListener('touchcancel', reset);

    attackBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.attack(); }, { passive: false });
    attackBtn.addEventListener('click', (e) => { e.preventDefault(); this.attack(); });
    console.log('📱 触屏虚拟控制已启用 (摇杆 + 攻击按钮)');
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    const self = this;
    function loop() {
      const delta = self.clock.getDelta();
      const time = self.clock.elapsedTime;
      if (!self.awaitingStart && self.hitStop <= 0 && self.gameState === 'playing') {
        self.updateMovement(delta);
      }
      self.animateAnimals(time, delta);
      self.animateCharacters(time, delta);
      if (!self.awaitingStart) self.updateProximity(time);
      self.updateGameplay(time, delta);
      self.renderer.render(self.scene, self.camera);
      requestAnimationFrame(loop);
    }
    loop();
  }
}

// ========== 音频系统：Web Audio 程序化合成（零外部文件依赖） ==========
class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmNodes = [];
    this.bgmOn = false;
    this.proximityCooldown = 0;
    this._bootstrap();
  }

  // 浏览器要求用户手势后才能播放音频，首次点击时启动
  _bootstrap() {
    const ensure = () => {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this._startBGM();
      console.log('🎵 音频引擎启动 (BGM + 音效)');
    };
    window.addEventListener('pointerdown', ensure, { once: false });
    window.addEventListener('keydown', ensure, { once: false });
  }

  // 背景音乐：播放用户提供的史诗 BGM（bgm-epic.mp3，循环）
  // 用 <audio> 元素循环播放，与 Web Audio 音效通道并存；音量用 gain 节点混入
  _startBGM() {
    if (!this.ctx || this.bgmOn) return;
    this.bgmOn = true;
    const ctx = this.ctx;
    const master = this.master;

    // BGM 增益（可单独调节音乐音量）
    const bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.55;
    bgmGain.connect(master);

    // 用 fetch 拉取 mp3 并解码为 AudioBuffer，支持循环无缝播放
    const url = 'assets/bgm-epic.mp3';
    fetch(url)
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.arrayBuffer(); })
      .then(buf => ctx.decodeAudioData(buf))
      .then(buffer => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(bgmGain);
        src.start();
        this._bgmSource = src;
        console.log('🎵 BGM 加载: bgm-epic.mp3 (' + Math.round(buffer.duration) + 's, 循环)');
      })
      .catch(e => {
        console.warn('⚠️ BGM 加载失败，回退到程序化垫音:', e);
        this._startPadFallback(ctx, master);
      });
  }

  // BGM 加载失败时的程序化垫音回退
  _startPadFallback(ctx, master) {
    if (this._padFallback) return;
    this._padFallback = true;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    padGain.connect(master);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 900;
    filter.connect(padGain);
    const chords = [[220,277.18,329.63],[196,246.94,293.66],[174.61,220,261.63],[164.81,207.65,246.94]];
    const oscs = [];
    chords[0].forEach(f => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.3;
      o.connect(g); g.connect(filter); o.start(); oscs.push(o);
    });
    let idx = 0;
    const timer = setInterval(() => {
      if (!this.bgmOn) { clearInterval(timer); return; }
      idx = (idx + 1) % chords.length;
      oscs.forEach((o, i) => o.frequency.setTargetAtTime(chords[idx][i], ctx.currentTime, 0.8));
    }, 4000);
    this.bgmNodes = oscs;
  }

  // 脚步音：短促的低频噪声砰
  step() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = 0.09;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 400;
    const g = this.ctx.createGain();
    g.gain.value = 0.35;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  // 靠近 NPC 提示音：清脆的叮
  chime() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.3);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.35);
    });
  }

  // 挥击：快速下滑的嘶声
  swing() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    const len = 0.15;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.2));
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
    const g = this.ctx.createGain(); g.gain.value = 0.28;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    // 频率下扫增强挥动感
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(400, t + len);
  }

  // 打空：很轻的短促声
  whiff() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 300;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  // 命中：清脆的撞击
  hit() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [220, 160].forEach(freq => {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.13);
    });
  }

  // 拾取：上扬的双音
  pickup() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [523, 784, 1046].forEach((freq, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.1, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.2);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.22);
    });
  }

  // 敌人倒地：低沉的爆裂（低通滤波去刺耳高频）
  enemyDown() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.32);
  }

  // 玩家受击：短促的低沉声（锯齿经低通去刺耳）
  hurt() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 220;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.22);
  }

  // 关卡开始：上行号角（低通滤波去除锯齿高频刺耳感）
  levelStart() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [392, 523, 659].forEach((freq, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.08, t + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.35);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t + i * 0.1); o.stop(t + i * 0.1 + 0.4);
    });
  }

  // 关卡通关：欢快琶音
  levelClear() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((freq, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.3);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.32);
    });
  }

  // Boss 出现：低沉威压（有停止时间，避免持续嗡声）
  bossStart() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 2.5);
  }

  // 胜利：辉煌长音
  victory() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [440, 554, 659, 880, 1108].forEach(freq => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 1.8);
    });
  }

  // 失败：下行哀鸣
  defeat() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [392, 330, 262, 196].forEach((freq, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t + i * 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.2 + 0.5);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.2); o.stop(t + i * 0.2 + 0.55);
    });
  }
}

// 启动游戏
window.game = new Game();

// 修复 Three.js GLTFLoader 动画 buffer 为空的问题
// 某些 GLB 文件加载后 interpolant._buffer 为空，导致动画不播放
function __fixAnimationBuffers() {
  const g = window.game;
  let fixed = 0;
  for (const mixer of g.mixers) {
    for (const action of mixer._actions) {
      const clip = action.getClip();
      if (!clip || !clip.tracks) continue;
      for (let ti = 0; ti < clip.tracks.length; ti++) {
        const track = clip.tracks[ti];
        const interp = action._interpolants[ti];
        if (!interp) continue;
        // 重置 cachedIndex 确保从正确位置开始搜索
        interp._cachedIndex = 0;
        // 如果 resultBuffer 大小不对，重建
        if (interp.resultBuffer && interp.resultBuffer.length !== track.getValueSize()) {
          interp.resultBuffer = new Float32Array(track.getValueSize());
        }
        // 确保 sampleValues 指向正确的数据
        if (track.values && interp.sampleValues !== track.values) {
          interp.sampleValues = track.values;
          fixed++;
        }
        // 同步 parameterPositions
        if (track.times && interp.parameterPositions !== track.times) {
          interp.parameterPositions = track.times;
        }
      }
    }
  }
  if (fixed > 0) console.log('🔧 修复了 ' + fixed + ' 个 interpolant 数据');
  else console.log('⚠️ __fixAnimationBuffers: 无数据需修复');
}
// 不在初始化时调用，改为在游戏加载完成后手动调用
// __fixAnimationBuffers();

// 测试钩子：检查绑定状态
window.__checkBind = () => {
  const g = window.game;
  const out = [];
  // 检查动物第一个 mixer
  const m = g.mixers[0];
  const b = m._bindings;
  let bound = 0, nullNode = 0, samples = [];
  for (let i = 0; i < b.length; i++) {
    const bd = b[i].binding;
    const n = bd.node;
    if (n) { bound++; if (i < 3) samples.push(bd.path + ' -> ' + n.name + '(' + n.type + ')'); }
    else nullNode++;
  }
  out.push('mixer0: total=' + b.length + ' bound=' + bound + ' nullNode=' + nullNode);
  out.push('samples: ' + samples.join(' | '));
  // 人物 mixer
  const cm = g.mixers[g.mixers.length - 1];
  const cb = cm._bindings;
  let cbound = 0, cnull = 0;
  for (let i = 0; i < cb.length; i++) {
    if (cb[i].binding.node) cbound++; else cnull++;
  }
  out.push('charMixer: total=' + cb.length + ' bound=' + cbound + ' nullNode=' + cnull);
  return out.join('\n');
};

// 测试钩子：手动驱动完整帧，验证动画是否应用到骨骼
window.__testAnim = () => {
  const g = window.game;
  const animal = g.mixers[0];
  const charMixer = g.mixers[g.mixers.length - 1];
  const qbAnimal = animal._bindings.filter(b => b.binding.path && b.binding.path.indexOf('quaternion') >= 0)[0];
  const qbChar = charMixer._bindings.filter(b => b.binding.path && b.binding.path.indexOf('quaternion') >= 0)[0];
  const aNode = qbAnimal.binding.node;
  const cNode = qbChar.binding.node;
  const qa0 = aNode.quaternion.toArray().join(',');
  const qc0 = cNode.quaternion.toArray().join(',');
  const ta0 = animal.time, tc0 = charMixer.time;
  // 直接手动推进 mixer（绕过 clock.getDelta 返回 0 的问题）
  for (let f = 0; f < 60; f++) {
    animal.update(1/60);
    charMixer.update(1/60);
    // 也驱动所有其他 mixer
    for (const m of g.mixers) { if (m !== animal && m !== charMixer) m.update(1/60); }
  }
  const qa1 = aNode.quaternion.toArray().join(',');
  const qc1 = cNode.quaternion.toArray().join(',');
  return JSON.stringify({
    animalTime: { t0: ta0.toFixed(2), t1: animal.time.toFixed(2) },
    charTime: { t0: tc0.toFixed(2), t1: charMixer.time.toFixed(2) },
    animalQChanged: qa0 !== qa1,
    charQChanged: qc0 !== qc1,
    animalQ0: qa0, animalQ1: qa1,
    charQ0: qc0, charQ1: qc1
  });
};
