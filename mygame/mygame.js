// @ts-check

import * as T from "../libs/Three/build/three.module.js";
import { OrbitControls } from "../libs/Three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "../libs/Three/examples/jsm/loaders/OBJLoader.js";

// spin!

// create the window that we want to draw into - this will
// create a Canvas element - we'll set it to be
let renderer = new T.WebGLRenderer();
renderer.setSize(600, 600);
// Prevent mobile browsers from turning touch drags into page scrolling so
// OrbitControls receives touch events reliably.
try { renderer.domElement.style.touchAction = "none"; } catch (e) {}
// put the canvas into the DOM
document.getElementById("div1").appendChild(renderer.domElement);

// simple loading overlay helpers
function showLoadingOverlay(msg) {
  try {
    let ov = document.getElementById('loadingOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'loadingOverlay';
      ov.style.position = 'fixed';
      ov.style.left = '0'; ov.style.top = '0'; ov.style.right = '0'; ov.style.bottom = '0';
      ov.style.display = 'flex'; ov.style.alignItems = 'center'; ov.style.justifyContent = 'center';
      ov.style.background = 'rgba(0,0,0,0.6)'; ov.style.color = '#fff'; ov.style.zIndex = '9999';
      ov.style.fontSize = '20px';
      document.body.appendChild(ov);
    }
    ov.textContent = msg || 'Loading...';
    ov.style.visibility = 'visible';
  } catch (e) {}
}
function hideLoadingOverlay() {
  try { const ov = document.getElementById('loadingOverlay'); if (ov) ov.style.visibility = 'hidden'; } catch (e) {}
}

// make a "scene" - a world to put the box into
let scene = new T.Scene();

// This transforms the world to the view
// in this case a simple scaling
//@@Snippet:camera5
let camera = new T.PerspectiveCamera(50, 1);
camera.position.set(3, 5, 5);
camera.lookAt(0, 0, 0);
//@@Snippet:camera5

// we are going to make our box out of green "stuff"
// this green stuff shows up as green even if there is no lighting
// We'll create scene content via builders so we can switch modes
let mesh1 = null;
let mesh2 = null;
let terrainData = null;
const TERR_MIN_Y = -8;
const SEA_LEVEL = 0;
// global tweak to shift player center Y (negative moves player down).
const PLAYER_Y_ADJUST = -0.8;
let player = { mesh: null, velocity: new T.Vector3(), onGround: true, groundOffset: 0.5, isSwimming: false, halfHeight: 0.5, walkTime: 0, spawnY: 0, flashTimer: 0 };
let controlsInitialized = false;
let inputState = { forward: false, back: false, left: false, right: false, jump: false };
// fish system
let fishes = [];
let fishGroup = null;
// splash particles for entering water
let splashGroup = null;
let splashParticles = []; // { mesh, vel }
// dynamic cube camera for water reflections
let dynamicCubeCamera = null;
let cubeCamAcc = 0;
const CUBE_CAM_UPDATE_INTERVAL = 0.8; // seconds between updates
// procedural star reflection texture for water (canvas texture)
// (star reflection / debug plane removed)
// --- Collectibles & HUD ---
let collectibles = [];
let collectiblesGroup = null;
// spawn tuning (editable)
let COLLECT_SPAWN_INTERVAL = 1.0; // seconds between spawn attempts
let COLLECT_MAX = 50; // maximum collectables on map
// spawn rates (sum not required, we'll check ranges)
let PROB_GOLD = 0.65;
let PROB_DIAMOND = 0.30;
let PROB_CHEST = 0.05;
// scoring
let score = 0;
let lives = 5;
let gameOver = false;
// spawn timer accumulator
let collectSpawnAcc = 0;

// HUD element
let hudEl = null;

// --- Pirates (skeletons) ---
let pirates = [];
let piratesGroup = null;
// spawn attempts base interval (lower -> more frequent)
let PIRATE_SPAWN_INTERVAL = 3.0; // seconds between spawn attempts (base)
let pirateSpawnAcc = 0;
// make pirates noticeably faster
const PIRATE_SPEED = 2.4;
// player's baseline horizontal speed (used by player movement and for pirate caps)
const PLAYER_SPEED = 3.0;
// how long (seconds) it takes a pirate to grow from base speed to the cap
const PIRATE_GROW_TIME = 200.0;
  // adaptive spawn tuning
  let pirateKillCount = 0;
  const PIRATE_KILLS_FOR_STEP = 10;
  const PIRATE_SPAWN_INTERVAL_FACTOR = 0.85; // multiply interval by this every step
  const MIN_PIRATE_SPAWN_INTERVAL = 0.6; // floor
// small global attraction weight so all pirates bias toward the player (0=no attract, 1=strong)
const PIRATE_ATTRACT_WEIGHT = 0.6;
const PIRATE_MAX = 15;
const PIRATE_ATTACK_RADIUS = 0.9; // how close pirate must get to hit player

// Optional full-mode hat model (loaded from ./models/PirateHat.obj)
let pirateHatModel = null;
// Optional full-mode treasure chest model (MTL + OBJ + PNG)
let treasureChestModel = null;
// Optional full-mode alien head model (MTL + OBJ + PNG)
let alienHeadModel = null;
// Optional full-mode cutlass model (MTL + OBJ + PNG)
let cutlassModel = null;
// optional face textures for pirates in Full mode
let pirateBackTexture = null;
let pirateChestTexture = null;
// Promises used to wait for model loading in Full mode
let pirateHatPromise = Promise.resolve();
let treasureChestPromise = Promise.resolve();
let alienHeadPromise = Promise.resolve();
let cutlassPromise = Promise.resolve();
try {
  if (typeof window !== 'undefined' && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__)) {
    try {
      // create a promise that resolves when the pirate hat model finishes loading (or fails)
      pirateHatPromise = new Promise((resolve) => {
        const _objL = new OBJLoader();
        _objL.load('./models/PirateHat.obj', (o) => {
        try {
          pirateHatModel = o;
          // ensure materials are standard-like so lighting looks correct
          pirateHatModel.traverse((c) => {
            if (c.isMesh && c.material) {
              // keep existing material but enable vertex normals if missing
              try { c.material.flatShading = false; c.material.needsUpdate = true; } catch (e) {}
            }
          });
          console.log('[mygame] PirateHat model loaded');
          // replace procedural hats on any already-spawned pirates
          try {
            if (pirates && pirates.length > 0) {
              for (let i = 0; i < pirates.length; ++i) {
                const p = pirates[i];
                try {
                  const head = p && p.mesh && p.mesh.head;
                  if (!head) continue;
                  // remove procedural hat children
                  for (let ci = head.children.length - 1; ci >= 0; --ci) {
                    const ch = head.children[ci];
                    try {
                      if (ch && ch.userData && ch.userData.isProceduralHat) {
                        head.remove(ch);
                        try { disposeObject(ch); } catch (e) {}
                      }
                    } catch (e) {}
                  }
                  // attach cloned hat model (nudge up and forward so it doesn't cover face)
                  const hatClone = pirateHatModel.clone(true);
                  // compute hat color from pirate behavior so cloned OBJ matches procedural hats
                  try {
                    let hatColor = 0xcc0000;
                    const beh = p && (p.behavior || (p.mesh && p.mesh.userData && p.mesh.userData.behavior));
                    if (beh === 'align') hatColor = 0x00aa00;
                    else if (beh === 'separate') hatColor = 0xaa55ff;
                    else if (beh === 'cohere') hatColor = 0xffff55;
                    // recolor any mesh materials on the hat clone to match
                    // Clone materials per-mesh so hat instances don't share materials
                    hatClone.traverse((c) => {
                      if (c && c.isMesh && c.material) {
                        try {
                          if (Array.isArray(c.material)) {
                            // replace with cloned material instances
                            c.material = c.material.map(m => m.clone());
                            c.material.forEach(m => { try { m.color && m.color.set(hatColor); } catch (e) {} });
                          } else {
                            c.material = c.material.clone();
                            try { if (c.material.color) c.material.color.set(hatColor); } catch (e) {}
                          }
                        } catch (e) {}
                      }
                    });
                  } catch (e) {}
                  // estimate head height via bounding box and raise hat +0.1 higher than before
                  try {
                    const bb = new T.Box3().setFromObject(head);
                    const hh = (bb.max.y - bb.min.y) || 0.4;
                    hatClone.position.set(0, hh / 2 + 0.24, 0.12);
                  } catch (e) {
                    hatClone.position.set(0, 0.48, 0.12);
                  }
                  hatClone.scale.set(0.5, 0.5, 0.5);
                  hatClone.rotation.set(0, 0, -0.08);
        head.add(hatClone);
                  // add a small disk to cover any circular hole at the top of the OBJ
                  try {
                    hatClone.updateMatrixWorld(true);
                    const _bb = new T.Box3().setFromObject(hatClone);
                    const topCenterWorld = new T.Vector3((_bb.min.x + _bb.max.x) * 0.5, _bb.max.y + 0.001, (_bb.min.z + _bb.max.z) * 0.5);
                    const topCenterLocal = hatClone.worldToLocal(topCenterWorld.clone());
                    const maxSpan = Math.max(_bb.max.x - _bb.min.x, _bb.max.z - _bb.min.z);
                    const diskRadius = Math.max(0.02, maxSpan * 0.5 * 0.9);
                    const diskGeo = new T.CircleGeometry(diskRadius, 24);
                    const diskMat = new T.MeshStandardMaterial({ color: hatColor, metalness: 0.05, roughness: 0.6 });
                    const disk = new T.Mesh(diskGeo, diskMat);
                    // orient disk horizontal (normal +Y)
                    disk.rotation.set(-Math.PI / 2, 0, 0);
                    disk.position.copy(topCenterLocal);
                    disk.userData = disk.userData || {};
                    disk.userData.isHatFill = true;
                    hatClone.add(disk);
                  } catch (e) {}
                } catch (e) {}
              }
            }
          } catch (e) {}
          // If the player exists and is using the Full-mode alien head, attach a black pirate hat to the player too
          try {
            if (player && player.mesh && player.mesh.head) {
              try {
                const phead = player.mesh.head;
                // remove any previous player hat we added earlier
                for (let ci = phead.children.length - 1; ci >= 0; --ci) {
                  const ch = phead.children[ci];
                  try { if (ch && ch.userData && ch.userData.isPlayerHat) { phead.remove(ch); disposeObject(ch); } } catch (e) {}
                }
                const playerHat = pirateHatModel.clone(true);
                // recolor to black specifically for player hat
                playerHat.traverse((c) => {
                  if (c && c.isMesh && c.material) {
                    try {
                      if (Array.isArray(c.material)) {
                        c.material = c.material.map(m => m.clone());
                        c.material.forEach(m => { try { m.color && m.color.set(0x000000); } catch (e) {} });
                      } else {
                        c.material = c.material.clone();
                        try { if (c.material.color) c.material.color.set(0x000000); } catch (e) {}
                      }
                    } catch (e) {}
                  }
                });
                // estimate head height and place hat relative to player's head
                try {
                  const bbp = new T.Box3().setFromObject(phead);
                  const hhp = (bbp.max.y - bbp.min.y) || 0.4;
                  playerHat.position.set(0, hhp / 2 + 0.24, 0.12);
                } catch (e) { playerHat.position.set(0, 0.48, 0.12); }
                playerHat.scale.set(0.5, 0.5, 0.5);
                playerHat.rotation.set(0, 0, -0.08);
                playerHat.userData = playerHat.userData || {}; playerHat.userData.isPlayerHat = true;
                phead.add(playerHat);
                // add small disk fill to match pirate hats
                try {
                  // Ensure the scene/world matrices are up to date so the bounding box is correct
                  try { if (typeof scene !== 'undefined' && scene && typeof scene.updateMatrixWorld === 'function') scene.updateMatrixWorld(true); } catch (e) { try { playerHat.updateMatrixWorld(true); } catch (e) {} }
                  const _bbp = new T.Box3().setFromObject(playerHat);
                  const topCenterWorldP = new T.Vector3((_bbp.min.x + _bbp.max.x) * 0.5, _bbp.max.y + 0.001, (_bbp.min.z + _bbp.max.z) * 0.5);
                  const topCenterLocalP = playerHat.worldToLocal(topCenterWorldP.clone());
                  const maxSpanP = Math.max(_bbp.max.x - _bbp.min.x, _bbp.max.z - _bbp.min.z);
                  // adjust disk radius multiplier per user tweaks (0.75)
                  const diskRadiusP = Math.max(0.02, maxSpanP * 0.5 * 0.75);
                  const diskGeoP = new T.CircleGeometry(diskRadiusP, 24);
                  const diskMatP = new T.MeshStandardMaterial({ color: 0x000000, metalness: 0.05, roughness: 0.6 });
                  const diskP = new T.Mesh(diskGeoP, diskMatP);
                  diskP.rotation.set(-Math.PI / 2, 0, 0);
                  diskP.position.copy(topCenterLocalP);
                  // apply cumulative nudge: total downward -0.8 and backward -0.25 (moved up 0.1)
                  try { diskP.position.y -= 0.8; diskP.position.z -= 0.25; } catch (e) {}
                  diskP.userData = diskP.userData || {};
                  diskP.userData.isHatFill = true;
                  playerHat.add(diskP);
                } catch (e) {}
              } catch (e) {}
            }
          } catch (e) {}
        } catch (e) { console.warn('pirate hat model setup failed', e); }
        finally {
          // resolve the pirateHatPromise on success or after any setup errors
          try { resolve(); } catch (e) {}
        }
        }, undefined, (err) => { console.warn('Failed to load PirateHat.obj', err); try { resolve(); } catch (e) {} });
      });
    } catch (e) { console.warn('OBJLoader not available to load PirateHat.obj', e); }
  }
} catch (e) {}

// load TreasureChest (MTL + OBJ) dynamically to avoid static type-only import issues
try {
  if (typeof window !== 'undefined' && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__)) {
    treasureChestPromise = new Promise((resolve) => {
      import('../libs/Three/examples/jsm/loaders/MTLLoader.js').then((mod) => {
        try {
          const MTLLoader = mod.MTLLoader;
          const mtlPath = './models/TreasureChest/Treasure_Chest_1203224535_texture.mtl';
          const objPath = './models/TreasureChest/Treasure_Chest_1203224535_texture.obj';
          const mloader = new MTLLoader();
          mloader.load(mtlPath, (materials) => {
            try {
              materials.preload();
              const objL = new OBJLoader();
              objL.setMaterials(materials);
              objL.load(objPath, (o) => {
                try {
                  treasureChestModel = o;
                  treasureChestModel.traverse((c) => {
                    if (c.isMesh && c.material) {
                      try { c.material.needsUpdate = true; } catch (e) {}
                    }
                  });
                  console.log('[mygame] TreasureChest model loaded');
                } catch (e) { console.warn('TreasureChest load callback error', e); }
                resolve();
              }, undefined, (err) => { console.warn('Failed to load TreasureChest.obj', err); resolve(); });
            } catch (e) { console.warn('Error preparing TreasureChest materials', e); resolve(); }
          }, undefined, (err) => { console.warn('Failed to load TreasureChest.mtl', err); resolve(); });
        } catch (e) { console.warn('Error during dynamic MTLLoader usage', e); resolve(); }
      }).catch((e) => { console.warn('Failed to import MTLLoader dynamically', e); resolve(); });
    });
  }
} catch (e) {}

// load Alien head model (MTL + OBJ + PNG) for Full mode
try {
  if (typeof window !== 'undefined' && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__)) {
    alienHeadPromise = new Promise((resolve) => {
      import('../libs/Three/examples/jsm/loaders/MTLLoader.js').then((mod) => {
        try {
          const MTLLoader = mod.MTLLoader;
          const mtlPath = './models/Alien_Head_texture_obj/Gray_Alien_Head_1204002109_texture.mtl';
          const objPath = './models/Alien_Head_texture_obj/Gray_Alien_Head_1204002109_texture.obj';
          const mloader = new MTLLoader();
          mloader.load(mtlPath, (materials) => {
            try {
              materials.preload();
              const objL = new OBJLoader();
              objL.setMaterials(materials);
              objL.load(objPath, (o) => {
                try {
                  alienHeadModel = o;
                  alienHeadModel.traverse((c) => { if (c.isMesh && c.material) try { c.material.needsUpdate = true; } catch (e) {} });
                  console.log('[mygame] Alien head model loaded');
                  // If the player was already created before the model finished loading,
                  // replace the player's head with the alien model so Full mode shows the model.
                  try {
                    if (player && player.mesh && player.mesh.head) {
                      try {
                        // remove existing head children
                        const oldHead = player.mesh.head;
                        for (let ci = oldHead.children.length - 1; ci >= 0; --ci) {
                          const ch = oldHead.children[ci];
                          try { oldHead.remove(ch); disposeObject(ch); } catch (e) {}
                        }
                        // attach cloned alien model
                        const clone = alienHeadModel.clone(true);
                        clone.traverse((c) => { try { if (c && c.isMesh) { c.userData = c.userData || {}; c.userData.isAlienHead = true; } } catch (e) {} });
                        // scale/align roughly to player's head
                        try {
                          const bb = new T.Box3().setFromObject(clone);
                          const size = new T.Vector3(); bb.getSize(size);
                          const targetY = (oldHead.geometry && oldHead.geometry.parameters && oldHead.geometry.parameters.height) ? oldHead.geometry.parameters.height : 0.4;
                          const sx = targetY / (size.y || targetY);
                          const sxw = ((oldHead.geometry && oldHead.geometry.parameters && oldHead.geometry.parameters.width) ? oldHead.geometry.parameters.width : 0.44) / (size.x || 0.44);
                          const sxd = ((oldHead.geometry && oldHead.geometry.parameters && oldHead.geometry.parameters.depth) ? oldHead.geometry.parameters.depth : 0.44) / (size.z || 0.44);
                          const s = Math.min(sx, sxw, sxd) * 0.95;
                          // scale the alien head to 1.9x the original target size
                          clone.scale.set(s * 1.9, s * 1.9, s * 1.9);
                                          const bb2 = new T.Box3().setFromObject(clone);
                                          clone.position.y -= bb2.min.y;
                                          // nudge the alien head forward and down for a better fit on the player
                                          try { clone.position.z += 0.092; clone.position.y -= 0.4; } catch (e) {}
                        } catch (e) {}
                        const headGroup = new T.Group(); headGroup.add(clone);
                        headGroup.position.copy(oldHead.position || new T.Vector3());
                        // replace head reference
                        try { player.mesh.remove(oldHead); } catch (e) {}
                        player.mesh.add(headGroup);
                        player.mesh.head = headGroup;
                        // If the pirate hat model is already loaded, attach a black pirate hat to the player's alien head
                        try {
                          if (pirateHatModel) {
                            try {
                              const phead = player.mesh.head;
                              // remove any previous player hat
                              for (let ci = phead.children.length - 1; ci >= 0; --ci) {
                                const ch = phead.children[ci];
                                try { if (ch && ch.userData && ch.userData.isPlayerHat) { phead.remove(ch); disposeObject(ch); } } catch (e) {}
                              }
                              const playerHat = pirateHatModel.clone(true);
                              playerHat.traverse((c) => {
                                if (c && c.isMesh && c.material) {
                                  try {
                                    if (Array.isArray(c.material)) {
                                      c.material = c.material.map(m => m.clone());
                                      c.material.forEach(m => { try { m.color && m.color.set(0x000000); } catch (e) {} });
                                    } else {
                                      c.material = c.material.clone();
                                      try { if (c.material.color) c.material.color.set(0x000000); } catch (e) {}
                                    }
                                  } catch (e) {}
                                }
                              });
                              try { const bbp = new T.Box3().setFromObject(phead); const hhp = (bbp.max.y - bbp.min.y) || 0.4; playerHat.position.set(0, hhp / 2 + 0.24, 0.12); } catch (e) { playerHat.position.set(0, 0.48, 0.12); }
                              playerHat.scale.set(0.5, 0.5, 0.5);
                              playerHat.rotation.set(0, 0, -0.08);
                              playerHat.userData = playerHat.userData || {}; playerHat.userData.isPlayerHat = true;
                              phead.add(playerHat);
                              try {
                                playerHat.updateMatrixWorld(true);
                                const _bbp = new T.Box3().setFromObject(playerHat);
                                const topCenterWorldP = new T.Vector3((_bbp.min.x + _bbp.max.x) * 0.5, _bbp.max.y + 0.001, (_bbp.min.z + _bbp.max.z) * 0.5);
                                const topCenterLocalP = playerHat.worldToLocal(topCenterWorldP.clone());
                                const maxSpanP = Math.max(_bbp.max.x - _bbp.min.x, _bbp.max.z - _bbp.min.z);
                                let diskRadiusP = Math.max(0.02, maxSpanP * 0.5 * 0.75);
                                // apply user-requested absolute decrease of 0.03, clamp to minimum
                                diskRadiusP = Math.max(0.02, diskRadiusP - 0.03);
                                const diskGeoP = new T.CircleGeometry(diskRadiusP, 24);
                                const diskMatP = new T.MeshStandardMaterial({ color: 0x000000, metalness: 0.05, roughness: 0.6 });
                                const diskP = new T.Mesh(diskGeoP, diskMatP);
                                diskP.rotation.set(-Math.PI / 2, 0, 0);
                                diskP.position.copy(topCenterLocalP);
                                try { diskP.position.y -= 1.0; diskP.position.z -= 0.25; } catch (e) {}
                                diskP.userData = diskP.userData || {};
                                diskP.userData.isHatFill = true;
                                playerHat.add(diskP);
                              } catch (e) {}
                            } catch (e) {}
                          }
                        } catch (e) {}
                      } catch (e) {}
                    }
                  } catch (e) {}
                } catch (e) { console.warn('Alien head load callback error', e); }
                resolve();
              }, undefined, (err) => { console.warn('Failed to load Alien head OBJ', err); resolve(); });
            } catch (e) { console.warn('Error preparing Alien head materials', e); resolve(); }
          }, undefined, (err) => { console.warn('Failed to load Alien head MTL', err); resolve(); });
        } catch (e) { console.warn('Error during dynamic Alien MTLLoader usage', e); resolve(); }
      }).catch((e) => { console.warn('Failed to import MTLLoader dynamically for Alien head', e); resolve(); });
    });
  }
} catch (e) { }

// load Cutlass model (MTL + OBJ + PNG) for Full mode
try {
  if (typeof window !== 'undefined' && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__)) {
    cutlassPromise = new Promise((resolve) => {
      import('../libs/Three/examples/jsm/loaders/MTLLoader.js').then((mod) => {
        try {
          const MTLLoader = mod.MTLLoader;
          const mtlPath = './models/Cutlass_texture_obj/Cutlass_1204004228_texture.mtl';
          const objPath = './models/Cutlass_texture_obj/Cutlass_1204004228_texture.obj';
          const mloader = new MTLLoader();
          mloader.load(mtlPath, (materials) => {
            try {
              materials.preload();
              const objL = new OBJLoader();
              objL.setMaterials(materials);
              objL.load(objPath, (o) => {
                try {
                  cutlassModel = o;
                  cutlassModel.traverse((c) => { if (c.isMesh && c.material) try { c.material.needsUpdate = true; } catch (e) {} });
                  console.log('[mygame] Cutlass model loaded');
                } catch (e) { console.warn('Cutlass load callback error', e); }
                resolve();
              }, undefined, (err) => { console.warn('Failed to load Cutlass OBJ', err); resolve(); });
            } catch (e) { console.warn('Error preparing Cutlass materials', e); resolve(); }
          }, undefined, (err) => { console.warn('Failed to load Cutlass MTL', err); resolve(); });
        } catch (e) { console.warn('Error during dynamic Cutlass MTLLoader usage', e); resolve(); }
      }).catch((e) => { console.warn('Failed to import MTLLoader dynamically for Cutlass', e); resolve(); });
    });
  }
} catch (e) { }

// --- Beam attack (player) ---
let beamActive = false;
let beamTimer = 0;
let beamCooldown = 0;
let beamMesh = null;
// ammo for beam
const BEAM_MAX_AMMO = 5;
let beamAmmo = BEAM_MAX_AMMO;
// editable tuning
let BEAM_DURATION = 3.0; // seconds beam lasts
let BEAM_LENGTH = 5.0; // beam length in world units (easy to edit)
let BEAM_COOLDOWN = 2.0; // seconds after beam disappears

// helper: compute player eye world position and forward direction
function getPlayerEyePosAndDir(outEye, outDir) {
  outEye = outEye || new T.Vector3();
  outDir = outDir || new T.Vector3();
  if (player && player.mesh) {
    // prefer head world position if available
    try {
      if (player.mesh.head && typeof player.mesh.head.getWorldPosition === 'function') {
        player.mesh.head.getWorldPosition(outEye);
      } else {
        outEye.copy(player.mesh.position).add(new T.Vector3(0, (player.halfHeight || 0.5), 0));
      }
      // forward is local +Z
      outDir.set(0, 0, 1).applyQuaternion(player.mesh.quaternion).normalize();
    } catch (e) {
      camera.getWorldPosition(outEye);
      camera.getWorldDirection(outDir);
    }
  } else {
    camera.getWorldPosition(outEye);
    camera.getWorldDirection(outDir);
  }
  return { eye: outEye, dir: outDir };
}

// create a simple beam mesh (thin box) oriented along +X in local space
function createBeamMesh(length) {
  // create a Group containing two cylindrical beams (one per eye).
  const g = new T.Group();
  // cylinder default axis is Y; rotate so axis aligns with +X
  const cylGeom = new T.CylinderGeometry(0.06, 0.06, length, 12);
  cylGeom.rotateZ(Math.PI / 2);
  const matL = new T.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.85, depthWrite: false });
  const matR = matL.clone();
  const left = new T.Mesh(cylGeom, matL);
  const right = new T.Mesh(cylGeom, matR);
  left.userData = left.userData || {};
  right.userData = right.userData || {};
  left.userData.length = length;
  right.userData.length = length;
  left.userData.isBeamLeft = true;
  right.userData.isBeamRight = true;
  g.add(left);
  g.add(right);
  return g;
}

function activateBeam() {
  if (beamActive) return;
  if (beamCooldown > 0) return;
  // require ammo
  if (typeof beamAmmo === 'number' && beamAmmo <= 0) return;
  beamActive = true;
  beamTimer = BEAM_DURATION;
  // consume one ammo
  try { if (typeof beamAmmo === 'number') { beamAmmo = Math.max(0, beamAmmo - 1); updateHUD(); } } catch (e) {}
  // create visual
  try {
    if (beamMesh) { try { scene.remove(beamMesh); try { beamMesh.traverse((c)=>{ try{ disposeObject(c); }catch(e){} }); } catch(e){} try { disposeObject(beamMesh); } catch(e){} } catch (e) {} beamMesh = null; }
    beamMesh = createBeamMesh(BEAM_LENGTH);
    scene.add(beamMesh);
  } catch (e) { beamMesh = null; }
}

// helper: set player color (traverses mesh materials)
function setPlayerColor(hex) {
  if (!player || !player.mesh) return;
  try {
    player.mesh.traverse((c) => {
      // don't recolor eyeballs (they should stay black/white independent of body color)
      try { if (c.userData && c.userData.isEye) return; } catch (e) {}
      // don't recolor textured materials (they use maps) or alien head meshes
      try { if (c.userData && c.userData.isAlienHead) return; } catch (e) {}
      try { if (c.material && c.material.map) return; } catch (e) {}
      // don't recolor anything that is part of the player's hat: skip if any ancestor is marked isPlayerHat
      try {
        let anc = c;
        while (anc) {
          try { if (anc.userData && anc.userData.isPlayerHat) return; } catch (e) {}
          anc = anc.parent;
        }
      } catch (e) {}
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.color && m.color.set(hex));
        else c.material.color && c.material.color.set(hex);
      }
    });
  } catch (e) {}
}

// squared distance from point p to segment ab
function pointToSegmentDistanceSq(p, a, b) {
  const ab = new T.Vector3().subVectors(b, a);
  const ap = new T.Vector3().subVectors(p, a);
  const ab2 = ab.lengthSq();
  if (ab2 === 0) return ap.lengthSq();
  let t = ap.dot(ab) / ab2;
  t = Math.max(0, Math.min(1, t));
  const proj = new T.Vector3().copy(a).addScaledVector(ab, t);
  return proj.distanceToSquared(p);
}



function initHUD() {
  if (hudEl) return;
  hudEl = document.createElement("div");
  hudEl.id = "hud";
  // place HUD inside the renderer container so it overlays the canvas
  // find renderer parent (the div with id "div1")
  const container = (renderer && renderer.domElement && renderer.domElement.parentElement) || document.getElementById("div1") || document.body;
  // ensure container can position absolute children
  try { if (window.getComputedStyle(container).position === "static") container.style.position = "relative"; } catch (e) {}
  hudEl.style.position = "absolute";
  hudEl.style.left = "12px";
  hudEl.style.right = "";
  hudEl.style.top = "12px";
  hudEl.style.padding = "8px 12px";
  hudEl.style.background = "rgba(0,0,0,0.45)";
  hudEl.style.color = "#fff";
  hudEl.style.fontFamily = "sans-serif";
  hudEl.style.fontSize = "16px";
  hudEl.style.zIndex = "2000";
  hudEl.style.borderRadius = "6px";
  hudEl.style.textAlign = "left";
  hudEl.innerHTML = `<div>Score: <span id=scoreVal>0</span></div><div>Lives: <span id=livesVal>5</span></div>`;
  // ammo display under lives
  hudEl.innerHTML += `<div>Ammo: <span id=ammoVal>${beamAmmo}</span></div>`;
  try { container.appendChild(hudEl); } catch (e) { document.body.appendChild(hudEl); }
  // debug: spawn pirates button (visible in HUD)
  // debug spawn button removed — not needed in current build
}

function updateHUD() {
  if (!hudEl) return;
  const s = document.getElementById("scoreVal");
  const l = document.getElementById("livesVal");
  const a = document.getElementById("ammoVal");
  if (s) s.textContent = String(score);
  if (l) l.textContent = String(lives);
  if (a) a.textContent = String(beamAmmo);
}

// Game over overlay: create once and show/hide as needed
function initGameOverScreen() {
  if (document.getElementById('gameOverOverlay')) return;
  const container = (renderer && renderer.domElement && renderer.domElement.parentElement) || document.getElementById('div1') || document.body;
  const overlay = document.createElement('div');
  overlay.id = 'gameOverOverlay';
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '5000';
  overlay.style.fontFamily = 'sans-serif';
  overlay.style.visibility = 'hidden';

  const box = document.createElement('div');
  box.style.background = '#111';
  box.style.color = '#fff';
  box.style.padding = '24px 32px';
  box.style.borderRadius = '8px';
  box.style.textAlign = 'center';
  box.style.minWidth = '260px';

  const title = document.createElement('div');
  title.style.fontSize = '28px';
  title.style.marginBottom = '12px';
  title.textContent = 'Game Over';
  box.appendChild(title);

  const scoreLine = document.createElement('div');
  scoreLine.id = 'gameOverScore';
  scoreLine.style.fontSize = '20px';
  scoreLine.style.marginBottom = '16px';
  scoreLine.textContent = 'Score: 0';
  box.appendChild(scoreLine);

  const btn = document.createElement('button');
  btn.textContent = 'Restart';
  btn.style.fontSize = '16px';
  btn.style.padding = '8px 14px';
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    try { restartGame(); } catch (e) { location.reload(); }
  });
  box.appendChild(btn);

  overlay.appendChild(box);
  try { container.appendChild(overlay); } catch (e) { document.body.appendChild(overlay); }
}

function showGameOver() {
  try { initGameOverScreen(); } catch (e) {}
  const ov = document.getElementById('gameOverOverlay');
  if (!ov) return;
  const scoreLine = document.getElementById('gameOverScore');
  if (scoreLine) scoreLine.textContent = 'Score: ' + String(score || 0);
  ov.style.visibility = 'visible';
  gameOver = true;
}

function hideGameOver() {
  const ov = document.getElementById('gameOverOverlay');
  if (!ov) return;
  ov.style.visibility = 'hidden';
  gameOver = false;
}

function restartGame() {
  // simple restart: reload the page so initialization runs cleanly
  try { location.reload(); } catch (e) { window.location.href = window.location.href; }
}

function createCollectibleMesh(type) {
  // type: "gold" | "diamond" | "chest"
  if (type === "gold") {
    // make gold emissive so it stands out
    const mat = new T.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.8, roughness: 0.25, emissive: 0xffd54f, emissiveIntensity: 1 });
    const geo = new T.CylinderGeometry(0.18, 0.18, 0.06, 12);
    const m = new T.Mesh(geo, mat);
    m.rotation.x = Math.PI / 2;
    return m;
  } else if (type === "diamond") {
    // make diamond slightly emissive and a bit shinier
    const mat = new T.MeshStandardMaterial({ color: 0x66ccff, metalness: 0.2, roughness: 0.15, flatShading: true, emissive: 0x66ccff, emissiveIntensity: 1 });
    // diamond-like octahedron
    const geo = new T.OctahedronGeometry(0.18);
    return new T.Mesh(geo, mat);
  } else {
    // chest — prefer an OBJ model in Full mode if available, otherwise keep primitive
    const isFull = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
    if (isFull && treasureChestModel) {
      try {
        const clone = treasureChestModel.clone(true);
        // attempt to normalize scale so it sits roughly where the primitive did
        try {
          // compute bounding box and scale to approximate primitive size
          const bb = new T.Box3().setFromObject(clone);
          const size = new T.Vector3(); bb.getSize(size);
          // double the previous full-model target size again (make OBJ noticeably larger)
          const targetW = 1.36, targetH = 0.8, targetD = 0.88;
          const sx = targetW / (size.x || 1);
          const sy = targetH / (size.y || 1);
          const sz = targetD / (size.z || 1);
          const s = Math.min(sx, sy, sz) * 0.95; // slightly smaller to be safe
          clone.scale.set(s, s, s);
        } catch (e) {}
        // position so base sits at y=0 (primitive half-height is 0.2; full-model doubled again -> half-height ~0.4)
        try { clone.position.y = 0.4; } catch (e) {}
        return clone;
      } catch (e) {
        // fall back to primitive on any error
      }
    }
    // primitive fallback: give a warm glow so it's visible (double size)
    const mat = new T.MeshStandardMaterial({ color: 0x8b4513, metalness: 0.1, roughness: 0.45, emissive: 0x442200, emissiveIntensity: 1 });
    const geo = new T.BoxGeometry(0.68, 0.4, 0.44);
    const m = new T.Mesh(geo, mat);
    m.position.y = 0.2; // half of 0.4
    return m;
  }
}

function spawnCollectibleAttempt() {
  if (!terrainData || !terrainData.heightMap) return;
  if (!collectiblesGroup) {
    collectiblesGroup = new T.Group();
    scene.add(collectiblesGroup);
  }
  if (collectibles.length >= COLLECT_MAX) return;
  // choose random water column
  const half = terrainData.half || 0;
  const attempts = 40;
  for (let i = 0; i < attempts; ++i) {
  // choose spawn coords one cell inset from the map edge to avoid edge artifacts
  const min = -half + 1;
  const max = half - 1;
  if (max < min) continue; // small maps: skip this attempt
  const ix = Math.floor(Math.random() * (max - min + 1)) + min;
  const iz = Math.floor(Math.random() * (max - min + 1)) + min;
    const info = terrainData.heightMap[`${ix},${iz}`];
    if (!info || info.topType !== "water") continue;
  // compute spawn Y: topSolid + 1 (top face of block) plus small offset so it sits above the block
  // raise all collectibles slightly (0.2) to avoid z-fighting / phasing with ground
  const topSolid = (typeof info.topSolid === 'number') ? info.topSolid : (SEA_LEVEL - 1);
  const y = topSolid + 1 + 0.12 + 0.2;
    // decide type by random roll
    const r = Math.random();
    let type = "gold";
    if (r < PROB_GOLD) type = "gold";
    else if (r < PROB_GOLD + PROB_DIAMOND) type = "diamond";
    else type = "chest";

    const mesh = createCollectibleMesh(type);
    mesh.position.set(ix + 0.5, y, iz + 0.5);
    // store base Y for bobbing and per-type animation params
    mesh.userData = mesh.userData || {};
    mesh.userData.baseY = mesh.position.y;
    mesh.userData.bobPhase = Math.random() * Math.PI * 2;
    // tuning: make gold sit a bit higher so it doesn't phase through the ground
    if (type === "gold") {
      mesh.userData.baseY += 0.12;
    }
    // per-type bob amplitude and rotation speed
    if (type === "gold") { mesh.userData.bobAmp = 0.09; mesh.userData.rotSpeed = 2.2; }
    else if (type === "diamond") { mesh.userData.bobAmp = 0.07; mesh.userData.rotSpeed = 1.8; }
    else { mesh.userData.bobAmp = 0.05; mesh.userData.rotSpeed = 1.2; }
    mesh.userData = mesh.userData || {};
    mesh.userData.collectType = type;
    // value
    mesh.userData.value = (type === "gold") ? 10 : (type === "diamond") ? 30 : 100;
    collectiblesGroup.add(mesh);
    collectibles.push({ mesh: mesh, type: type });
    break;
  }
}

function removeCollectibleAtIndex(idx) {
  const c = collectibles[idx];
  if (!c) return;
  try { collectiblesGroup.remove(c.mesh); disposeObject(c.mesh); } catch (e) {}
  collectibles.splice(idx, 1);
}

function updateCollectibles(dt) {
  // spawn timer
  collectSpawnAcc += dt;
  while (collectSpawnAcc >= COLLECT_SPAWN_INTERVAL) {
    collectSpawnAcc -= COLLECT_SPAWN_INTERVAL;
    spawnCollectibleAttempt();
  }

  if (!player || !player.mesh) return;
  const ppos = player.mesh.position;
  const pickupR = 0.8;
  const pickupR2 = pickupR * pickupR;
  for (let i = collectibles.length - 1; i >= 0; --i) {
    const c = collectibles[i];
    if (!c || !c.mesh) continue;
    // animate: spin and bob
    try {
      const m = c.mesh;
      m.userData = m.userData || {};
      const now = (performance && performance.now) ? performance.now() * 0.001 : Date.now() * 0.001;
      const phase = (m.userData.bobPhase || 0) + now;
      const amp = (typeof m.userData.bobAmp === 'number') ? m.userData.bobAmp : 0.06;
      const baseY = (typeof m.userData.baseY === 'number') ? m.userData.baseY : m.position.y;
      m.position.y = baseY + Math.sin(phase) * amp;
      const rot = (typeof m.userData.rotSpeed === 'number') ? m.userData.rotSpeed : 1.5;
      // gold is a flat coin (cylinder) — spin around its local axis so it looks like a coin
      if (m.userData && m.userData.collectType === 'gold') {
        m.rotation.z += rot * dt;
      } else {
        m.rotation.y += rot * dt;
      }
    } catch (e) {}
    const d2 = ppos.distanceToSquared(c.mesh.position);
    if (d2 <= pickupR2) {
      // pickup
      const ctype = (c.mesh.userData && c.mesh.userData.collectType) ? c.mesh.userData.collectType : null;
      const cval = (c.mesh.userData && c.mesh.userData.value) ? c.mesh.userData.value : 0;
      score += cval;
      // if chest, refill beam ammo
      try {
        if (ctype === 'chest') { beamAmmo = BEAM_MAX_AMMO; }
      } catch (e) {}
      updateHUD();
      removeCollectibleAtIndex(i);
    }
  }
}
// tuning constants
const FISH_COUNT = 50;
const FISH_Y_OPTIONS = [0.2, -0.8, -1.8];
const FISH_SPEED = 1.6;
// margin (in world units) to keep fish spawns inset from map edges so they don't escape
const FISH_SPAWN_MARGIN = 10;
const COHESION_RADIUS = 4.0;
const COHESION_STRENGTH = 1.5; // how strongly fish move toward neighbors
const FISH_JITTER = 0.6;

function randomPastel() {
  const r = 120 + Math.floor(Math.random() * 135);
  const g = 120 + Math.floor(Math.random() * 135);
  const b = 120 + Math.floor(Math.random() * 135);
  return (r << 16) | (g << 8) | b;
}

// create a splash effect at given world x,z when entering water threshold
function spawnSplashAt(x, z) {
  try {
    if (!splashGroup) {
      splashGroup = new T.Group();
      splashGroup.userData = splashGroup.userData || {};
      scene.add(splashGroup);
    }
    // choose water color from terrainData if available
    let splashColor = 0x3366ff;
    try { if (terrainData && terrainData.matWater && terrainData.matWater.color) splashColor = terrainData.matWater.color.getHex(); } catch (e) {}
    const mat = new T.MeshStandardMaterial({ color: splashColor, metalness: 0.0, roughness: 0.9 });
    // spawn ~15 small spheres
    const count = 15;
    for (let i = 0; i < count; ++i) {
      const r = 0.03 + Math.random() * 0.04;
      const geo = new T.SphereGeometry(r, 6, 6);
      const m = new T.Mesh(geo, mat);
      // start at water surface
      const waterY = (terrainData && terrainData.matWater) ? (SEA_LEVEL + 1 - 0.01) : 0.0;
      // choose a random angle and radial offset so particles arc outward from the center
      const angle = Math.random() * Math.PI * 2;
      const startOffset = 0.02 + Math.random() * 0.18; // small radial start offset
      const sx = x + Math.cos(angle) * startOffset;
      const sz = z + Math.sin(angle) * startOffset;
      m.position.set(sx, waterY, sz);
      // radial speed outward (varying) and upward velocity
      const radialSpeed = 0.8 + Math.random() * 2.2; // horizontal speed magnitude
      const vx = Math.cos(angle) * radialSpeed;
      const vz = Math.sin(angle) * radialSpeed;
      const vy = 2.2 + Math.random() * 1.8; // upward speed
      splashGroup.add(m);
      splashParticles.push({ mesh: m, vel: new T.Vector3(vx, vy, vz), startY: waterY });
    }
  } catch (e) { console.warn('spawnSplashAt failed', e); }
}

function updateSplashes(dt) {
  if (!splashParticles || splashParticles.length === 0) return;
  const gravity = -9.8;
  for (let i = splashParticles.length - 1; i >= 0; --i) {
    const p = splashParticles[i];
    try {
      // integrate
      p.vel.y += gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      // when particle returns to or below startY and is moving downward, remove it
      if (p.mesh.position.y <= p.startY && p.vel.y < 0) {
        try { splashGroup.remove(p.mesh); disposeObject(p.mesh); } catch (e) {}
        splashParticles.splice(i, 1);
      }
    } catch (e) {}
  }
  // if group empty, remove it from scene
  try { if (splashGroup && splashParticles.length === 0) { scene.remove(splashGroup); splashGroup = null; } } catch (e) {}
}

// apply loaded pirate face textures to already-spawned pirates
function applyPirateTextures() {
  try {
    if (!pirates || pirates.length === 0) return;
    for (let i = 0; i < pirates.length; ++i) {
      const p = pirates[i];
      if (!p || !p.mesh) continue;
      try {
        // create/update front/back planes on the torso so textures are visible
        p.mesh.traverse((c) => {
          try {
            if (c && c.userData && c.userData.isPirateTorso) {
              try { createOrUpdatePiratePlanesForTorso(c); } catch (e) {}
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
  } catch (e) {}
}

function createOrUpdatePiratePlanesForTorso(torso) {
  try {
    if (!torso) return;
    // compute torso size from bounding box
    const bb = new T.Box3().setFromObject(torso);
    const size = new T.Vector3(); bb.getSize(size);
    const w = Math.max(0.1, size.x * 0.9);
    const h = Math.max(0.1, size.y * 0.9);
    const d = Math.max(0.05, size.z);
    // small offset to avoid z-fighting with torso faces
    const offset = 0.02 + d * 0.01;

    // front plane
    let front = torso.getObjectByName('pirateFrontPlane');
    if (!front) {
      const geo = new T.PlaneGeometry(w, h);
      const mat = pirateChestTexture ? new T.MeshStandardMaterial({ map: pirateChestTexture, alphaTest: 0.4, side: T.DoubleSide }) : new T.MeshStandardMaterial({ color: 0xffffff });
      front = new T.Mesh(geo, mat);
      front.name = 'pirateFrontPlane';
      front.userData = front.userData || {};
      front.userData.isPirateFrontPlane = true;
      // plane default faces +Z
      front.position.set(0, 0, d / 2 + offset);
      torso.add(front);
    } else {
      // update material if texture now available
      try { if (pirateChestTexture) { front.material.map = pirateChestTexture; front.material.alphaTest = 0.4; front.material.side = T.DoubleSide; front.material.needsUpdate = true; } } catch (e) {}
      // adjust geometry if size changed
      try { front.geometry.dispose(); front.geometry = new T.PlaneGeometry(w, h); } catch (e) {}
      front.position.set(0, 0, d / 2 + offset);
    }

    // back plane
    let back = torso.getObjectByName('pirateBackPlane');
    if (!back) {
      const geo = new T.PlaneGeometry(w, h);
      const mat = pirateBackTexture ? new T.MeshStandardMaterial({ map: pirateBackTexture, alphaTest: 0.4, side: T.DoubleSide }) : new T.MeshStandardMaterial({ color: 0xffffff });
      back = new T.Mesh(geo, mat);
      back.name = 'pirateBackPlane';
      back.userData = back.userData || {};
      back.userData.isPirateBackPlane = true;
      // rotate to face -Z
      back.rotation.y = Math.PI;
      back.position.set(0, 0, -d / 2 - offset);
      torso.add(back);
    } else {
      try { if (pirateBackTexture) { back.material.map = pirateBackTexture; back.material.alphaTest = 0.4; back.material.side = T.DoubleSide; back.material.needsUpdate = true; } } catch (e) {}
      try { back.geometry.dispose(); back.geometry = new T.PlaneGeometry(w, h); } catch (e) {}
      back.rotation.y = Math.PI;
      back.position.set(0, 0, -d / 2 - offset);
    }
  } catch (e) {}
}

// create a simple low-poly fish group (body + tail). Returns a Group.
function createFishMesh(color) {
  const g = new T.Group();
  const mat = new T.MeshStandardMaterial({ color: color, flatShading: true });
  // body: a stretched box (nose toward +Z)
  const body = new T.Mesh(new T.BoxGeometry(0.28, 0.16, 0.6), mat);
  body.position.set(0, 0, 0);
  g.add(body);
  // tail: thin box positioned at the rear (-Z)
  const tailMat = new T.MeshStandardMaterial({ color: color, flatShading: true });
  const tail = new T.Mesh(new T.BoxGeometry(0.06, 0.14, 0.28), tailMat);
  tail.position.set(0, 0, -0.3);
  // make tail pivot-friendly by moving geometry origin to the front (toward the body)
  // NOTE: translate must be negative so the local origin sits at the front face
  tail.geometry.translate(0, 0, -0.14);
  g.add(tail);
  // small top fin for silhouette
  const finMat = new T.MeshStandardMaterial({ color: 0x222222, flatShading: true });
  const fin = new T.Mesh(new T.BoxGeometry(0.02, 0.06, 0.18), finMat);
  // move fin slightly forward (toward the nose) so it sits closer to the body
  // move fin a bit more forward toward the nose for a tighter silhouette
  fin.position.set(0, 0.08, 0);
  g.add(fin);
  // store tail in userData for animation
  g.userData.tail = tail;
  return g;
}

// simple pirate mesh (skeleton-like) — white, right arm extended with sword, hat colored by behavior
function createPirateMesh(behavior) {
  const g = new T.Group();
  // default skeleton color (white)
  const mat = new T.MeshStandardMaterial({ color: 0xffffff });
  // basic proportions
  const legH = 0.5, legW = 0.22, legD = 0.22;
  const torsoH = 0.7, torsoW = 0.55, torsoD = 0.32;
  const armH = torsoH, armW = 0.14, armD = 0.14;
  const headH = 0.38, headW = 0.40, headD = 0.40;

  const leftLegGeo = new T.BoxGeometry(legW, legH, legD); leftLegGeo.translate(0, -legH/2, 0);
  const leftLeg = new T.Mesh(leftLegGeo, mat); leftLeg.position.set(-torsoW*0.22, legH, 0); g.add(leftLeg);
  const rightLegGeo = new T.BoxGeometry(legW, legH, legD); rightLegGeo.translate(0, -legH/2, 0);
  const rightLeg = new T.Mesh(rightLegGeo, mat); rightLeg.position.set(torsoW*0.22, legH, 0); g.add(rightLeg);
  const torsoGeo = new T.BoxGeometry(torsoW, torsoH, torsoD);
  let torso = null;
  try {
    if (isFull && (pirateBackTexture || pirateChestTexture)) {
      // Create per-face materials: order is [right, left, top, bottom, front, back]
      const rightMat = new T.MeshStandardMaterial({ color: 0xffffff });
      const leftMat = new T.MeshStandardMaterial({ color: 0xffffff });
      const topMat = new T.MeshStandardMaterial({ color: 0xffffff });
      const bottomMat = new T.MeshStandardMaterial({ color: 0xffffff });
      const frontMat = pirateChestTexture ? new T.MeshStandardMaterial({ map: pirateChestTexture }) : new T.MeshStandardMaterial({ color: 0xffffff });
      const backMat = pirateBackTexture ? new T.MeshStandardMaterial({ map: pirateBackTexture }) : new T.MeshStandardMaterial({ color: 0xffffff });
      const mats = [rightMat, leftMat, topMat, bottomMat, frontMat, backMat];
      torso = new T.Mesh(torsoGeo, mats);
      try { torso.userData = torso.userData || {}; torso.userData.isPirateTorso = true; } catch (e) {}
    } else {
      torso = new T.Mesh(torsoGeo, mat);
      try { torso.userData = torso.userData || {}; torso.userData.isPirateTorso = true; } catch (e) {}
    }
  } catch (e) {
    torso = new T.Mesh(torsoGeo, mat);
  }
  torso.position.set(0, legH + torsoH/2, 0); g.add(torso);
  try { createOrUpdatePiratePlanesForTorso(torso); } catch (e) {}
  const leftArmGeo = new T.BoxGeometry(armW, armH, armD); leftArmGeo.translate(0, -armH/2, 0);
  const leftArm = new T.Mesh(leftArmGeo, mat); leftArm.position.set(-torsoW/2 - armW/2, legH + torsoH, 0); g.add(leftArm);
  // create an arm pivot at the shoulder so we can rotate the whole arm around a controllable pivot
  const armPivot = new T.Group();
  // align pivot with torso (z=0) so shoulder pivot sits in line with the torso
  try { armPivot.position.set(torsoW/2 + armW/2, legH + torsoH - 0.06, 0); } catch (e) { armPivot.position.set(torsoW/2 + armW/2, legH + torsoH - 0.06, 0); }
  g.add(armPivot);
  // arm pivot debug marker removed (was used for tuning)

  const rightArmGeo = new T.BoxGeometry(armW, armH, armD); rightArmGeo.translate(0, -armH/2, 0);
  const rightArm = new T.Mesh(rightArmGeo, mat);
  // position rightArm relative to the armPivot (pivot at shoulder); keep a small forward nudge
  try { rightArm.position.set(0, 0, 0); } catch (e) { rightArm.position.set(0, 0, 0); }
  rightArm.rotation.x = -0.45;
  armPivot.add(rightArm);
  // create a pivot at the hand so the weapon can rotate around the handle
  const handPivot = new T.Group();
  // place the pivot roughly where the hand should be relative to the arm
  // place pivot further inside the arm (deeper along -Z)
  // slightly up (+Y) and out (+Z) so pivot sits closer to the fist opening
  // Move hand pivot forward by +0.08 on Z to match previous visible marker
  try { handPivot.position.set(0, -armH + 0.08, armD / 2 - 0.06); } catch (e) { handPivot.position.set(0, -armH + 0.08, armD / 2 - 0.06); }
  rightArm.add(handPivot);
  // hand pivot debug marker removed (was used for tuning)
  // sword on right arm - add to handPivot so rotation is around the handle
  let sword = null;
  try {
    const isFull = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
    if (isFull && cutlassModel) {
      try {
        const clone = cutlassModel.clone(true);
        // try to normalize scale so blade length ~0.6
        try {
          const bb = new T.Box3().setFromObject(clone);
          const size = new T.Vector3(); bb.getSize(size);
          const targetLen = 0.6;
          const s = (targetLen / (size.z || targetLen)) / 3;
          clone.scale.set(s, s, s);
        } catch (e) {}
        // position the cutlass relative to the hand pivot (handle at pivot)
        try { clone.position.set(0, -0.1, 0.65); clone.rotation.set(-Math.PI / 2, -Math.PI / 2, 0); } catch (e) {}
        handPivot.add(clone);
        sword = clone;
      } catch (e) { sword = null; }
    }
  } catch (e) { sword = null; }
  if (!sword) {
    // fallback primitive sword
    sword = new T.Mesh(new T.BoxGeometry(0.05, 0.02, 0.6), new T.MeshStandardMaterial({ color: 0xcccccc }));
    try { sword.geometry.translate(0, 0, 0.3); } catch (e) {}
    // place blade so handle sits at pivot origin
    try { sword.position.set(0, 0, 0); sword.rotation.x = 0; } catch (e) {}
    handPivot.add(sword);
  }
  // expose pivot and sword for later adjustments and animation
  try { g.handPivot = handPivot; g.sword = sword; g.armPivot = armPivot; } catch (e) {}
  // head + eyes + hat differ between Prototype (primitive) and Full modes.
  const isFull = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
  let head;
  if (!isFull) {
    // Prototype / primitive: keep original box head and original procedural hat placement
    head = new T.Mesh(new T.BoxGeometry(headW, headH, headD), mat);
    head.position.set(0, legH + torsoH + headH / 2, 0);
    g.add(head);
    // add simple eyeballs on the front of the head (primitive positions)
    try {
      const eyeMat = new T.MeshStandardMaterial({ color: 0x000000 });
      const eyeSize = Math.min(headW, headH) * 0.12;
      const leftEye = new T.Mesh(new T.SphereGeometry(eyeSize, 8, 8), eyeMat);
      const rightEye = new T.Mesh(new T.SphereGeometry(eyeSize, 8, 8), eyeMat);
      try { leftEye.userData = leftEye.userData || {}; leftEye.userData.isEye = true; } catch (e) {}
      try { rightEye.userData = rightEye.userData || {}; rightEye.userData.isEye = true; } catch (e) {}
      leftEye.position.set(-headW * 0.18, 0.05 * headH, headD * 0.52);
      rightEye.position.set(headW * 0.18, 0.05 * headH, headD * 0.52);
      head.add(leftEye);
      head.add(rightEye);
    } catch (e) {}
  } else {
    // Full mode: spherical head (rounder) and eyes positioned for sphere
    const headRadius = Math.max(headW, headH, headD) * 0.5;
    head = new T.Mesh(new T.SphereGeometry(headRadius, 12, 10), mat);
    head.position.set(0, legH + torsoH + headH / 2, 0);
    g.add(head);
    // add simple eyeballs on the front of the head (sphere positions)
    try {
      const eyeMat = new T.MeshStandardMaterial({ color: 0x000000 });
      const eyeSize = Math.min(headW, headH) * 0.12;
      const leftEye = new T.Mesh(new T.SphereGeometry(eyeSize, 8, 8), eyeMat);
      const rightEye = new T.Mesh(new T.SphereGeometry(eyeSize, 8, 8), eyeMat);
      try { leftEye.userData = leftEye.userData || {}; leftEye.userData.isEye = true; } catch (e) {}
      try { rightEye.userData = rightEye.userData || {}; rightEye.userData.isEye = true; } catch (e) {}
      leftEye.position.set(-headRadius * 0.36, 0.05 * headH, headRadius * 0.9);
      rightEye.position.set(headRadius * 0.36, 0.05 * headH, headRadius * 0.9);
      head.add(leftEye);
      head.add(rightEye);
    } catch (e) {}
  }
  // hat color by behavior
  let hatColor = 0xcc0000; if (behavior === 'align') hatColor = 0x00aa00; else if (behavior === 'separate') hatColor = 0xaa55ff; else if (behavior === 'cohere') hatColor = 0xffff55;
  // hat: prefer using an external model in Full mode if available, otherwise build procedurally
  try {
    if (isFull && pirateHatModel) {
      try {
        const hatClone = pirateHatModel.clone(true);
        // scale down to 0.5 and nudge forward/up so it doesn't cover the face
        hatClone.scale.set(0.5, 0.5, 0.5);
        // raise hat 0.1 higher so it sits clear of the face
        hatClone.position.set(0, headH / 2 + 0.24, 0.12);
        hatClone.rotation.set(0, 0, -0.08);
        // recolor cloned hat to match procedural hat color
        // Clone materials so each hat instance has independent materials
        try {
          hatClone.traverse((c) => {
            if (c && c.isMesh && c.material) {
              try {
                if (Array.isArray(c.material)) {
                  c.material = c.material.map(m => m.clone());
                  c.material.forEach(m => { try { m.color && m.color.set(hatColor); } catch (e) {} });
                } else {
                  c.material = c.material.clone();
                  try { if (c.material.color) c.material.color.set(hatColor); } catch (e) {}
                }
              } catch (e) {}
            }
          });
        } catch (e) {}
        head.add(hatClone);
        // add a simple disk above the head sized to the head dimensions
        try {
          // radius: head-based plus small offset (user adjustments)
          const diskRadius = Math.max(0.02, Math.max(headW, headD) * 0.5 + 0.175);
          const diskGeo = new T.CircleGeometry(diskRadius, 24);
          const diskMat = new T.MeshStandardMaterial({ color: hatColor, metalness: 0.05, roughness: 0.6 });
          const disk = new T.Mesh(diskGeo, diskMat);
          disk.rotation.set(-Math.PI / 2, 0, 0); // make disk parallel to ground
          // apply latest user adjustments: lower by another 0.05 and move back another 0.05
          disk.position.set(0, headH / 2 - 0.17, -0.25);
          disk.userData = disk.userData || {};
          disk.userData.isHatFill = true;
          hatClone.add(disk);
        } catch (e) {}
      } catch (e) {
        // fall back to procedural hat below if clone fails
        throw e;
      }
    } else {
      // build a simple pirate-style hat: a flat brim + a raised crown and a small white emblem
      const hatGroup = new T.Group();
      const hatMat = new T.MeshStandardMaterial({ color: hatColor, metalness: 0.05, roughness: 0.6 });
      // brim: a low cylinder flattened to act like a broad brim
      const brimRadius = Math.max(headW, headD) * 0.9;
      const brimGeo = new T.CylinderGeometry(brimRadius, brimRadius, 0.06, 20);
      const brim = new T.Mesh(brimGeo, hatMat);
      // lay the brim flat (cylinder axis is Y); raise it slightly above head top
      brim.rotation.x = Math.PI / 12;
      brim.position.y = headH / 2 + 0.04;
      hatGroup.add(brim);
      // crown: smaller cylinder sitting above the brim
      const crownGeo = new T.CylinderGeometry(brimRadius * 0.48, brimRadius * 0.58, 0.38, 16);
      const crown = new T.Mesh(crownGeo, hatMat);
      crown.position.y = headH / 2 + 0.26;
      hatGroup.add(crown);
      // small white skull emblem on the front of the hat for pirate flair
      const skullSize = Math.min(headW, headD) * 0.18;
      const skullGeo = new T.CircleGeometry(skullSize, 12);
      const skullMat = new T.MeshBasicMaterial({ color: 0xffffff });
      const skull = new T.Mesh(skullGeo, skullMat);
      // place the emblem on the front face (positive Z) a little above brim
      skull.position.set(0, headH / 2 + 0.12, brimRadius * 0.55);
      // face the emblem outward (CircleGeometry faces +Z by default)
      hatGroup.add(skull);
      // slight tilt for style
      hatGroup.rotation.z = -0.08;
      // In Prototype (primitive) mode we keep the original placement (no extra scale/pos).
      if (isFull) {
        // scale procedural hat down to match OBJ size and nudge forward for Full fallback
        try { hatGroup.scale.set(0.5, 0.5, 0.5); hatGroup.position.set(0, headH / 2 + 0.08, 0.12); } catch (e) {}
      }
      hatGroup.userData = hatGroup.userData || {};
      hatGroup.userData.isProceduralHat = true;
      head.add(hatGroup);
    }
  } catch (e) {
    try { console.warn('hat model attach failed, using procedural hat', e); } catch (e) {}
    // graceful fallback: procedural hat
    try {
      const hatGroup = new T.Group();
      const hatMat = new T.MeshStandardMaterial({ color: hatColor, metalness: 0.05, roughness: 0.6 });
      const brimRadius = Math.max(headW, headD) * 0.9;
      const brimGeo = new T.CylinderGeometry(brimRadius, brimRadius, 0.06, 20);
      const brim = new T.Mesh(brimGeo, hatMat);
      brim.rotation.x = Math.PI / 12;
      brim.position.y = headH / 2 + 0.04;
      hatGroup.add(brim);
      const crownGeo = new T.CylinderGeometry(brimRadius * 0.48, brimRadius * 0.58, 0.38, 16);
      const crown = new T.Mesh(crownGeo, hatMat);
      crown.position.y = headH / 2 + 0.26;
      hatGroup.add(crown);
      const skullSize = Math.min(headW, headD) * 0.18;
      const skullGeo = new T.CircleGeometry(skullSize, 12);
      const skullMat = new T.MeshBasicMaterial({ color: 0xffffff });
      const skull = new T.Mesh(skullGeo, skullMat);
      skull.position.set(0, headH / 2 + 0.12, brimRadius * 0.55);
      hatGroup.add(skull);
      hatGroup.rotation.z = -0.08;
      // keep original placement for prototype; for full fallback we'd have scaled above
      try { if (isFull) hatGroup.scale.set(0.5, 0.5, 0.5); if (isFull) hatGroup.position.set(0, headH / 2 + 0.08, 0.12); } catch (e) {}
      hatGroup.userData = hatGroup.userData || {};
      hatGroup.userData.isProceduralHat = true;
      head.add(hatGroup);
    } catch (e) {}
  }
  // expose for animation
  g.leftLeg = leftLeg; g.rightLeg = rightLeg; g.leftArm = leftArm; g.rightArm = rightArm; g.torso = torso; g.head = head;
  // expose sword so update loop can animate it during attacks
  try { g.sword = sword; } catch (e) {}
  g.userData = g.userData || {}; g.userData.behavior = behavior;
  return g;
}

function removePirateAtIndex(idx) {
  const p = pirates[idx]; if (!p) return;
  try { piratesGroup.remove(p.mesh); disposeObject(p.mesh); } catch(e) {}
  pirates.splice(idx, 1);
  try {
    pirateKillCount = (pirateKillCount || 0) + 1;
    // every N kills, make pirates spawn more often (reduce interval)
    if (pirateKillCount % PIRATE_KILLS_FOR_STEP === 0) {
      PIRATE_SPAWN_INTERVAL = Math.max(MIN_PIRATE_SPAWN_INTERVAL, PIRATE_SPAWN_INTERVAL * PIRATE_SPAWN_INTERVAL_FACTOR);
      console.log('pirate spawn interval reduced to', PIRATE_SPAWN_INTERVAL);
    }
  } catch (e) {}
}

function spawnPirateAttempt() {
  if (!terrainData || !terrainData.heightMap) return;
  if (!piratesGroup) { piratesGroup = new T.Group(); scene.add(piratesGroup); }
  if (pirates.length >= PIRATE_MAX) return;
  const half = terrainData.half || 0;
  const min = -half + 1, max = half - 1;
  if (max < min) return;
  // try attempts
  for (let i=0;i<30;++i) {
    const ix = Math.floor(Math.random() * (max - min + 1)) + min;
    const iz = Math.floor(Math.random() * (max - min + 1)) + min;
    const info = terrainData.heightMap[`${ix},${iz}`];
    if (!info) continue;
    // avoid spawning too close to the player (XZ-only)
    try {
      if (player && player.mesh) {
        const spawnX = ix + 0.5;
        const spawnZ = iz + 0.5;
        const dx = spawnX - player.mesh.position.x;
        const dz = spawnZ - player.mesh.position.z;
        const minDist = 10.0;
        if (dx*dx + dz*dz <= minDist * minDist) continue;
      }
    } catch (e) {}
    if (info.topType === 'water') continue; // spawn on land
    const behaviors = ['none','align','separate','cohere'];
    const b = behaviors[Math.floor(Math.random()*behaviors.length)];
    const m = createPirateMesh(b);
    const bbox = new T.Box3().setFromObject(m);
  const pHeight = (bbox.max.y - bbox.min.y) || 1.0; const pHalf = pHeight/2;
  const spawnTop = (typeof info.topSolid === 'number') ? info.topSolid : info.surface;
  // lower pirates slightly so they sit more on the ground (avoid floating)
  const centerY = spawnTop + 1 + pHalf + PLAYER_Y_ADJUST - 0.2;
  m.position.set(ix + 0.5, centerY, iz + 0.5);
    const ang = Math.random()*Math.PI*2;
    const vel = new T.Vector3(Math.cos(ang),0,Math.sin(ang)).multiplyScalar(PIRATE_SPEED);
    const nowSec = (performance && performance.now) ? performance.now() * 0.001 : Date.now() * 0.001;
    piratesGroup.add(m);
    console.log('spawned pirate at', ix, centerY, iz, 'behavior', b);
    pirates.push({ mesh: m, velocity: vel, behavior: b, half: pHalf, spawnTime: nowSec });
    break;
  }
}

function updatePirates(dt) {
  if (!terrainData || !terrainData.heightMap) return;
  // spawn timer
  pirateSpawnAcc += dt;
  while (pirateSpawnAcc >= PIRATE_SPAWN_INTERVAL) { pirateSpawnAcc -= PIRATE_SPAWN_INTERVAL; spawnPirateAttempt(); }
  if (!piratesGroup) return;
  const half = terrainData.half || 0;
  const occ = terrainData.occupancy;
  for (let i=pirates.length-1;i>=0;--i) {
    const p = pirates[i]; const m = p.mesh; const v = p.velocity;
    // compute per-pirate effective speed that grows with lifetime
    const _nowSec = (performance && performance.now) ? performance.now() * 0.001 : Date.now() * 0.001;
    p.spawnTime = (typeof p.spawnTime === 'number') ? p.spawnTime : _nowSec;
    const _age = Math.max(0, _nowSec - p.spawnTime);
    const _growT = Math.max(0, Math.min(1, _age / PIRATE_GROW_TIME));
    const _maxSpeed = PLAYER_SPEED * 1.5;
    const effectiveSpeed = PIRATE_SPEED + (_maxSpeed - PIRATE_SPEED) * _growT;
    // handle hit timer (scheduled removal after being hit)
    if (p.hitTimer && p.hitTimer > 0) {
      p.hitTimer -= dt;
      if (p.hitTimer <= 0) {
        try {
          // award points if killed by beam
          if (p.hitByBeam) { score += 5; updateHUD(); }
        } catch(e) {}
        try { removePirateAtIndex(i); } catch(e) {}
        continue;
      }
    }
    // simple wander/steer depending on behavior (tiny influence)
    if (p.behavior === 'align' || p.behavior === 'cohere' || p.behavior === 'separate') {
      let count = 0; const center = new T.Vector3(); const align = new T.Vector3(); const sep = new T.Vector3();
      for (const o of pirates) { if (o===p) continue; const d2 = m.position.distanceToSquared(o.mesh.position); if (d2 > 16) continue; count++; center.add(o.mesh.position); align.add(o.velocity); const diff = new T.Vector3().subVectors(m.position, o.mesh.position); if (diff.lengthSq()>1e-6) { diff.normalize().divideScalar(Math.sqrt(d2)); sep.add(diff); } }
      if (count>0) { center.multiplyScalar(1/count); align.multiplyScalar(1/count); sep.multiplyScalar(1/count); if (p.behavior==='cohere') { const toCenter = new T.Vector3().subVectors(center, m.position); toCenter.y=0; if (toCenter.lengthSq()>1e-6) { toCenter.normalize(); v.lerp(toCenter.multiplyScalar(effectiveSpeed), dt*0.6); } } if (p.behavior==='align') { align.y=0; if (align.lengthSq()>1e-6) { align.normalize(); v.lerp(align.multiplyScalar(effectiveSpeed), dt*0.8); } } if (p.behavior==='separate') { sep.y=0; if (sep.lengthSq()>1e-6) { sep.normalize(); v.lerp(sep.multiplyScalar(effectiveSpeed), dt*1.2); } } }
    }

    // global attraction: slightly bias all pirates toward the player's XZ position
    try {
      if (player && player.mesh) {
        const toPlayer = new T.Vector3().subVectors(player.mesh.position, m.position);
        toPlayer.y = 0;
          if (toPlayer.lengthSq() > 1e-6) {
          toPlayer.normalize();
          // lerp velocity toward a velocity pointing at the player
          const attractFactor = Math.max(0, Math.min(1, PIRATE_ATTRACT_WEIGHT));
          v.lerp(toPlayer.multiplyScalar(effectiveSpeed), dt * 0.6 * attractFactor);
        }
      }
  } catch (e) {}
    // maintain speed
    const tmp = new T.Vector3(v.x,0,v.z); if (tmp.lengthSq()>1e-6) { tmp.normalize().multiplyScalar(effectiveSpeed); v.x=tmp.x; v.z=tmp.z; }
    // propose next (move in XZ, then snap Y to terrain topSolid for that column)
    const next = m.position.clone().addScaledVector(v, dt);
    // bounce only off map edge
    if (next.x < -half+0.5 || next.x > half-0.5) { v.x = -v.x; next.x = m.position.x + v.x*dt; }
    if (next.z < -half+0.5 || next.z > half-0.5) { v.z = -v.z; next.z = m.position.z + v.z*dt; }
    // determine column and set Y to the column's topSolid center (so pirates ride terrain)
    const newColX = Math.floor(next.x), newColZ = Math.floor(next.z);
    if (terrainData && terrainData.heightMap) {
      const infoCol = terrainData.heightMap[`${newColX},${newColZ}`];
      if (infoCol && typeof infoCol.topSolid === 'number') {
          // match spawn offset: lower pirates a bit so they don't appear to float
          next.y = infoCol.topSolid + 1 + (p.half || 0.5) + PLAYER_Y_ADJUST - 0.2;
        }
    }
    m.position.copy(next);
    // face move
    const look = m.position.clone().add(v); m.lookAt(look);
    // simple limb animation
    try {
      const tnow = (performance && performance.now ? performance.now()*0.001 : Date.now()*0.001);
      // If pirate is in attack animation, override rightArm and sword rotation to perform lift->strike->straighten
      if (p.attacking) {
        try {
          p.attackElapsed = (p.attackElapsed || 0) + dt;
          const ph = p.attackPhases || { liftDuration: 0.25, strikeDuration: 0.15, holdDuration: 0.45 };
          const l = ph.liftDuration || 0.25;
          const s = ph.strikeDuration || 0.15;
          const h = ph.holdDuration || 0.45;
          const ae = Math.min(p.attackElapsed, l + s + h);
          if (ae < l) {
            // lift: rotate shoulder pivot up toward target (90 degrees up)
            const u = ae / l;
            const base = (typeof p._armBaseRotX === 'number') ? p._armBaseRotX : 0;
            const tgtUp = (typeof p._armTargetUp === 'number') ? p._armTargetUp : (base - Math.PI / 2);
            const armRot = base + (tgtUp - base) * u;
            try { if (m.armPivot) m.armPivot.rotation.x = armRot; } catch (e) {}
            // keep handPivot at base during lift
            try { if (m.handPivot) m.handPivot.rotation.x = (typeof p._handPivotBase === 'number' ? p._handPivotBase : 0); } catch (e) {}
          } else if (ae < l + s) {
            // strike: rotate arm down toward down-target while hand pivot rotates down simultaneously
            const u = (ae - l) / s;
            const armUp = (typeof p._armTargetUp === 'number') ? p._armTargetUp : ((typeof p._armBaseRotX === 'number' ? p._armBaseRotX : 0) - Math.PI / 2);
            const armDown = (typeof p._armTargetDown === 'number') ? p._armTargetDown : ((typeof p._armBaseRotX === 'number' ? p._armBaseRotX : 0) + Math.PI / 4);
            const handBase = (typeof p._handPivotBase === 'number') ? p._handPivotBase : 0;
            const handDown = (typeof p._handPivotTargetDown === 'number') ? p._handPivotTargetDown : (handBase + Math.PI / 4);
            const armRot = armUp + (armDown - armUp) * u;
            const handRot = handBase + (handDown - handBase) * u;
            try { if (m.armPivot) m.armPivot.rotation.x = armRot; } catch (e) {}
            try { if (m.handPivot) m.handPivot.rotation.x = handRot; } catch (e) {}
          } else {
            // hold final strike pose: arm down target and hand down target
            try { if (m.armPivot) m.armPivot.rotation.x = (typeof p._armTargetDown === 'number' ? p._armTargetDown : ((typeof p._armBaseRotX === 'number' ? p._armBaseRotX : 0) + Math.PI / 4)); } catch (e) {}
            try { if (m.handPivot) m.handPivot.rotation.x = (typeof p._handPivotTargetDown === 'number' ? p._handPivotTargetDown : ((typeof p._handPivotBase === 'number' ? p._handPivotBase : 0) + Math.PI / 4)); } catch (e) {}
          }
        } catch (e) {}
      }
      // always animate legs for walking
      try { if (m.leftLeg && m.rightLeg) { m.leftLeg.rotation.x = Math.sin(tnow*4)*0.5; m.rightLeg.rotation.x = -Math.sin(tnow*4)*0.5; } } catch(e) {}
    } catch(e) {}
    // check hit player (XZ only) — if pirate hits player, perform a single damage and play attack animation
    if (player && player.mesh) {
      const dx = player.mesh.position.x - m.position.x;
      const dz = player.mesh.position.z - m.position.z;
      const d2xz = dx*dx + dz*dz;
      if (d2xz <= PIRATE_ATTACK_RADIUS * PIRATE_ATTACK_RADIUS) {
        try {
          // only damage player once per pirate
          if (!p.didDamage) {
            p.didDamage = true;
            lives = Math.max(0, lives - 1);
            updateHUD();
            try { if (lives <= 0) showGameOver(); } catch (e) {}
            try { player.flashTimer = 1.0; setPlayerColor(0xff0000); } catch (e) {}
          }
        } catch (e) {}
        // start attack animation (lift then strike) and schedule removal after animation
        if (!p.attacking) {
          p.attacking = true;
          p.attackElapsed = 0;
          p.attackPhases = { liftDuration: 0.25, strikeDuration: 0.15, holdDuration: 0.45 };
          p.attackDuration = p.attackPhases.liftDuration + p.attackPhases.strikeDuration + p.attackPhases.holdDuration;
          // reuse existing hitTimer to schedule removal after animation
          p.hitTimer = p.attackDuration;
          // record base pivot rotations so lerp is smooth and animate only pivots
          try { p._armBaseRotX = (m.armPivot && typeof m.armPivot.rotation.x === 'number') ? m.armPivot.rotation.x : 0; } catch (e) { p._armBaseRotX = 0; }
          // lift target: raise shoulder pivot by 90 degrees from base
          p._armTargetUp = (typeof p._armBaseRotX === 'number') ? (p._armBaseRotX - Math.PI / 2) : -Math.PI / 2;
          // down/strike target: rotate shoulder pivot down 45 degrees relative to the lifted angle
          // (i.e., arm will come down only 45° from the lifted pose)
          p._armTargetDown = (typeof p._armTargetUp === 'number') ? (p._armTargetUp + Math.PI / 4) : ((typeof p._armBaseRotX === 'number') ? (p._armBaseRotX + Math.PI / 4) : (Math.PI / 4));
          try { p._handPivotBase = (m.handPivot && typeof m.handPivot.rotation.x === 'number') ? m.handPivot.rotation.x : 0; } catch (e) { p._handPivotBase = 0; }
          // hand pivot will rotate down 45 degrees during the strike
          // add extra 10 degrees (in radians) to hand pivot down target when arm comes down
          const EXTRA_HAND_DOWN = Math.PI / 6;
          p._handPivotTargetDown = (typeof p._handPivotBase === 'number') ? (p._handPivotBase + Math.PI / 4 + EXTRA_HAND_DOWN) : (Math.PI / 4 + EXTRA_HAND_DOWN);
        }
        // don't remove immediately; allow animation to run then removal will happen via hitTimer branch above
        continue;
      }
    }
  }
}

// reusable temporaries to avoid per-frame allocations
const _vMove = new T.Vector3();
const _camForward = new T.Vector3();
const _camRight = new T.Vector3();
const _worldMove = new T.Vector3();
const _upVec = new T.Vector3(0, 1, 0);

function ensureControls() {
  if (controlsInitialized) return;
  controlsInitialized = true;

  // keyboard
  window.addEventListener("keydown", (ev) => {
    const k = ev.key.toLowerCase();
    if (k === "w" || ev.key === "ArrowUp") inputState.forward = true;
    if (k === "s" || ev.key === "ArrowDown") inputState.back = true;
    if (k === "a" || ev.key === "ArrowLeft") inputState.left = true;
    if (k === "d" || ev.key === "ArrowRight") inputState.right = true;
    // beam activation (press E)
    if (k === "e") {
      try { activateBeam(); } catch (e) {}
    }
    if (ev.code === "Space") {
      inputState.jump = true;
      ev.preventDefault();
    }
  });
  window.addEventListener("keyup", (ev) => {
    const k = ev.key.toLowerCase();
    if (k === "w" || ev.key === "ArrowUp") inputState.forward = false;
    if (k === "s" || ev.key === "ArrowDown") inputState.back = false;
    if (k === "a" || ev.key === "ArrowLeft") inputState.left = false;
    if (k === "d" || ev.key === "ArrowRight") inputState.right = false;
    if (ev.code === "Space") inputState.jump = false;
  });

  // on-screen buttons for mobile
  createOnScreenButtons();
}

function createOnScreenButtons() {
  const container = document.getElementById("onScreenButtons");
  if (!container) return;
  container.innerHTML = "";
  // place the d-pad in the bottom-left of the canvas using a 3x4 grid
  container.style.position = "absolute";
  // keep the D-pad snug to the bottom-left of the canvas (nudged down slightly)
  container.style.bottom = "-14px";
  container.style.left = "12px";
  container.style.width = "196px"; // 3*56 + 2*8 gap
  container.style.height = "236px"; // 4*56 + 3*8 gap
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 56px)";
  container.style.gridTemplateRows = "repeat(4, 56px)";
  container.style.gap = "8px";
  // ensure the button container's parent is positioned so absolute children are confined
  if (container.parentElement && container.parentElement.style) {
    const p = container.parentElement;
    if (!p.style.position || p.style.position === "") p.style.position = "relative";
  }

  function makeButton(label, onDown, onUp) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.minWidth = "48px";
    b.style.minHeight = "48px";
    b.style.fontSize = "16px";
    b.style.opacity = "0.9";
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onDown();
    });
    b.addEventListener("pointerup", (e) => {
      e.preventDefault();
      onUp();
    });
    b.addEventListener("pointercancel", (e) => {
      e.preventDefault();
      onUp();
    });
    b.addEventListener("pointerleave", (e) => {
      e.preventDefault();
      onUp();
    });
    return b;
  }

  // small helper to create a random pastel color for fish
  function randomPastel() {
    const r = 120 + Math.floor(Math.random() * 135);
    const g = 120 + Math.floor(Math.random() * 135);
    const b = 120 + Math.floor(Math.random() * 135);
    return (r << 16) | (g << 8) | b;
  }

  // layout: up, left+right, down, jump
  // D-pad: place arrows around an empty center cell
  const upBtn = makeButton("↑", () => (inputState.forward = true), () => (inputState.forward = false));
  upBtn.style.gridColumn = "2"; upBtn.style.gridRow = "1";
  container.appendChild(upBtn);

  const leftBtn = makeButton("←", () => (inputState.left = true), () => (inputState.left = false));
  leftBtn.style.gridColumn = "1"; leftBtn.style.gridRow = "2";
  container.appendChild(leftBtn);

  // center cell left empty for the "square empty area"
  const rightBtn = makeButton("→", () => (inputState.right = true), () => (inputState.right = false));
  rightBtn.style.gridColumn = "3"; rightBtn.style.gridRow = "2";
  container.appendChild(rightBtn);

  const downBtn = makeButton("↓", () => (inputState.back = true), () => (inputState.back = false));
  downBtn.style.gridColumn = "2"; downBtn.style.gridRow = "3";
  container.appendChild(downBtn);

  // Jump will be a separate button placed at the bottom-right of the canvas (inside canvas parent)
  const jumpBtn = makeButton("Jump", () => (inputState.jump = true), () => (inputState.jump = false));
  // keep the same size for the jump button and make it responsive
  jumpBtn.style.width = "56px";
  jumpBtn.style.height = "56px";
  jumpBtn.style.boxSizing = "border-box";
  // prefer to append to the renderer's parent so the button stays inside the canvas area
  let parent = null;
  try {
    if (typeof renderer !== "undefined" && renderer.domElement && renderer.domElement.parentElement) {
      parent = renderer.domElement.parentElement;
    }
  } catch (e) {
    parent = null;
  }
  if (!parent) parent = container.parentElement || document.body;
  // ensure the parent is positioned so absolute positioning is relative to it
  if (parent && parent.style && (!parent.style.position || parent.style.position === "")) {
    parent.style.position = "relative";
  }
  // append and absolutely position inside the parent (bottom-right)
  parent.appendChild(jumpBtn);
  jumpBtn.style.position = "absolute";
  // place Jump at fixed coordinates inside an 600x600 game canvas (x=325, y=325)
  jumpBtn.style.left = "525px";
  jumpBtn.style.top = "525px";
  jumpBtn.style.zIndex = "999";
  // clamp max size so it won't overflow on very large screens
  jumpBtn.style.maxWidth = "120px";
  jumpBtn.style.maxHeight = "120px";
}

/* Player height debugger removed per user request */

function disposeObject(obj) {
  try {
    if (obj.geometry) obj.geometry.dispose();
  } catch (e) {}
  try {
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose && m.dispose());
      } else {
        obj.material.dispose && obj.material.dispose();
      }
    }
  } catch (e) {}
}

function clearScene() {
  // dispose and remove all children
  for (let i = scene.children.length - 1; i >= 0; --i) {
    let ch = scene.children[i];
    // if an object is marked persistent, keep it across rebuilds
    if (ch.userData && ch.userData.persistent) continue;
    scene.remove(ch);
    disposeObject(ch);
  }
}

function buildPrototype() {
  // generate a block-style terrain and place the player on top of (0,0)
  const MAP_SIZE = 65; // 100x100 for initial testing
  const MIN_Y = -35;
  const SEA_LEVEL = 0;

  // small Perlin noise implementation (2D)
  // adapted from improved Perlin noise (simple, sufficient for heightmap)
  const perm = (() => {
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; ++i) p[i] = i;
    for (let i = 255; i > 0; --i) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 256; ++i) p[i + 256] = p[i];
    return p;
  })();

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + t * (b - a);
  }

  function grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function perlin2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const topRight = perm[perm[X + 1] + Y + 1];
    const topLeft = perm[perm[X] + Y + 1];
    const bottomRight = perm[perm[X + 1] + Y];
    const bottomLeft = perm[perm[X] + Y];

    const u = fade(xf);
    const v = fade(yf);

    const x1 = lerp(grad(bottomLeft, xf, yf), grad(bottomRight, xf - 1, yf), u);
    const x2 = lerp(grad(topLeft, xf, yf - 1), grad(topRight, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  function generateHeight(x, z) {
    // combine octaves
    const scale = 0.05; // controls feature size
    let n = 0;
    let amp = 1;
    let freq = 1;
    let max = 0;
    for (let o = 0; o < 4; ++o) {
      n += perlin2((x * freq) * scale, (z * freq) * scale) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    n = n / max; // normalize roughly to -1..1
    const amplitude = 12; // maximum terrain variation
    return Math.floor(n * amplitude);
  }

  function generateTerrain(size) {
    const half = Math.floor(size / 2);
    const grassPositions = [];
    const dirtPositions = [];
    const stonePositions = [];
    const waterPositions = [];
    const heightMap = {};

    // first pass: sample raw heights
    const raw = {};
    for (let ix = -half; ix < half; ++ix) {
      for (let iz = -half; iz < half; ++iz) {
        const h = generateHeight(ix, iz);
        raw[`${ix},${iz}`] = h;
      }
    }

    // second pass: build blocks, but make shoreline grass where adjacent to land
    function neighborHasLand(ix, iz) {
      const ncoords = [ [ix+1,iz], [ix-1,iz], [ix,iz+1], [ix,iz-1] ];
      for (const [nx, nz] of ncoords) {
        const v = raw[`${nx},${nz}`];
        if (v !== undefined && v > SEA_LEVEL) return true;
      }
      return false;
    }

    for (let ix = -half; ix < half; ++ix) {
      for (let iz = -half; iz < half; ++iz) {
        const h = raw[`${ix},${iz}`];
        // default top type
        let topType = h > SEA_LEVEL ? "grass" : "water";
        let surface = h;
        // shoreline: if adjacent to land, place grass at sea level
        if (h <= SEA_LEVEL && neighborHasLand(ix, iz)) {
          topType = "grass";
          surface = SEA_LEVEL;
        }
        // outer rim: force the outer-most map cells to be land (1-cell rim)
        // if they would otherwise be water. This prevents water at the map edge.
        const isEdge = (ix === -half) || (ix === half - 1) || (iz === -half) || (iz === half - 1);
        if (isEdge && h <= SEA_LEVEL) {
          topType = "grass";
          surface = SEA_LEVEL;
        }
  // compute the top-most solid block for this column
  // if the top is non-water (grass), the topSolid is the surface
  // if the top is water, the stone layer starts at h-1 so that's the top solid
  const topSolid = topType !== "water" ? surface : (h - 1);
  heightMap[`${ix},${iz}`] = { surface, topType, topSolid };

        if (topType === "grass") {
          // top grass
          grassPositions.push([ix, surface, iz]);
          // two dirt below
          for (let d = 1; d <= 2; ++d) {
            const y = surface - d;
            if (y >= TERR_MIN_Y) dirtPositions.push([ix, y, iz]);
          }
          // stone below
          for (let y = surface - 3; y >= TERR_MIN_Y; --y) stonePositions.push([ix, y, iz]);
        } else {
          // water column exists here (we'll render a smooth surface later)
          // stone below water
          for (let y = h - 1; y >= TERR_MIN_Y; --y) stonePositions.push([ix, y, iz]);
        }
      }
    }

    // helper: build a voxel mesh that only includes exposed faces (no internal faces)
    function buildVoxelMesh(positions, material, occupancy) {
      if (positions.length === 0) return null;
      const vertices = [];
      const normals = [];
      const uvs = [];
      const indices = [];

      // face templates (4 vertices, normal)
      const faces = [
        // +X
        { dir: [1, 0, 0], verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], normal: [1, 0, 0] },
        // -X
        { dir: [-1, 0, 0], verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], normal: [-1, 0, 0] },
        // +Y
        { dir: [0, 1, 0], verts: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], normal: [0, 1, 0] },
        // -Y
        { dir: [0, -1, 0], verts: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], normal: [0, -1, 0] },
        // +Z
        { dir: [0, 0, 1], verts: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], normal: [0, 0, 1] },
        // -Z
        { dir: [0, 0, -1], verts: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], normal: [0, 0, -1] }
      ];

      let vertCount = 0;
      for (let i = 0; i < positions.length; ++i) {
        const px = positions[i][0];
        const py = positions[i][1];
        const pz = positions[i][2];
        for (let f = 0; f < faces.length; ++f) {
          const fd = faces[f].dir;
          const nx = px + fd[0];
          const ny = py + fd[1];
          const nz = pz + fd[2];
          // if neighbor occupied, skip this face
          if (occupancy[`${nx},${ny},${nz}`]) continue;
          // add face
          const fv = faces[f].verts;
          for (let v = 0; v < 4; ++v) {
            const vx = px + fv[v][0];
            const vy = py + fv[v][1];
            const vz = pz + fv[v][2];
            vertices.push(vx, vy, vz);
            normals.push(faces[f].normal[0], faces[f].normal[1], faces[f].normal[2]);
            // simple UVs
            uvs.push(v === 0 || v === 3 ? 0 : 1, v < 2 ? 0 : 1);
          }
          // two triangles
          indices.push(vertCount, vertCount + 1, vertCount + 2, vertCount, vertCount + 2, vertCount + 3);
          vertCount += 4;
        }
      }

      if (vertices.length === 0) return null;
      const geom = new T.BufferGeometry();
      geom.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
      geom.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
      geom.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeBoundingSphere();
      return new T.Mesh(geom, material);
    }

  // create materials
  // If running the Full mode (texture atlas), use white base colors so the
  // atlas textures are not tinted by the material color. The flag may be set
  // either directly (__USE_TEXTURE_ATLAS__) or via the Full-page boot (__FORCE_FULL__).
  const isFullMode = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
  const matGrass = new T.MeshStandardMaterial({ color: isFullMode ? 0xffffff : 0x00aa00 });
  const matDirt = new T.MeshStandardMaterial({ color: isFullMode ? 0xffffff : 0x8b5a2b });
  const matStone = new T.MeshStandardMaterial({ color: isFullMode ? 0xffffff : 0x888888 });
    // water will be a single smooth plane at the sea surface so it blends visually
    const matWater = new T.MeshStandardMaterial({ color: 0x3366ff, transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide });

    // If Full mode requests a texture atlas, prepare a loader and helper to remap UVs
    let __atlasTex = null;
    function _applyAtlasToMesh(mesh, kind, tex) {
      if (!mesh || !mesh.geometry) return;
      try {
        // assign texture as map
        mesh.material = mesh.material || new T.MeshStandardMaterial();
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
        tex.needsUpdate = true;
        // remap UVs based on vertex normals (top/side/bottom)
        const geom = mesh.geometry;
        const uvAttr = geom.attributes.uv;
        const nAttr = geom.attributes.normal;
        if (!uvAttr || !nAttr) return;
        const count = uvAttr.count;
        // 2x2 atlas helper using explicit column,row indices (visual rows where row=0 is TOP)
        const ts = 1.0 / 2.0; // tile size
        function tileUVFromColRow(col, visualRow, u, v, tex) {
          // tex.flipY: if false, UV v=0 corresponds to TOP of image; if true (default), v=0 is BOTTOM
          // visualRow: 0 = TOP, 1 = BOTTOM
          let vMin;
          if (tex && tex.flipY === false) {
            // UV origin at top-left
            vMin = visualRow * ts;
          } else {
            // UV origin at bottom-left (three.js default flipY=true)
            vMin = 1.0 - (visualRow + 1) * ts;
          }
          const uMin = col * ts;
          const newU = uMin + (u * ts);
          const newV = vMin + (v * ts);
          return [newU, newV];
        }

        for (let i = 0; i < count; ++i) {
          let u = uvAttr.getX(i);
          let v = uvAttr.getY(i);
          // determine face normal direction
          const nx = nAttr.getX(i);
          const ny = nAttr.getY(i);
          const nz = nAttr.getZ(i);
          // Per-user mapping (visual coords):
          // Stone -> top-left (col=0,row=0) all faces
          // Dirt  -> bottom-left (col=0,row=1) all faces
          // Grass -> top face: top-right (col=1,row=0)
          //          side faces: bottom-right (col=1,row=1)
          //          bottom face: bottom-left (col=0,row=1)
          let col = 0, row = 0;
          if (kind === 'stone') { col = 0; row = 0; }
          else if (kind === 'dirt') { col = 0; row = 1; }
          else if (kind === 'grass') {
            if (ny > 0.5) { col = 1; row = 0; } // top
            else if (ny < -0.5) { col = 0; row = 1; } // bottom
            else { col = 1; row = 1; } // sides
          } else { col = 0; row = 0; }

          // allow rotating the sampled UVs for grass sides only
          let sampleU = u, sampleV = v;
          if (kind === 'grass' && Math.abs(ny) <= 0.5) {
            sampleU = v;
            sampleV = 1 - u;
          }

          const [newU, newV] = tileUVFromColRow(col, row, sampleU, sampleV, mesh.material && mesh.material.map ? mesh.material.map : tex);
          uvAttr.setXY(i, newU, newV);
        }
        uvAttr.needsUpdate = true;
        try { geom.computeBoundingSphere(); } catch (e) {}
      } catch (e) { console.warn('applyAtlas failed', e); }
    }

    if (window && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__)) {
      try {
        const loader = new T.TextureLoader();
  __atlasTex = loader.load('./textures/gametexture.png', (t) => {
    try { t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; t.flipY = false; } catch (e) {}
          // debug log to indicate atlas has loaded
          try { console.log('[mygame] atlas loaded:', t.image && t.image.src ? t.image.src : t); } catch (e) {}
          // debug overlay removed (atlas debug canvas was intentionally deleted)
          // if meshes already exist, apply immediately (closures below will also apply once created)
          try { if (typeof stoneMesh !== 'undefined' && stoneMesh) _applyAtlasToMesh(stoneMesh, 'stone', t); } catch (e) {}
          try { if (typeof dirtMesh !== 'undefined' && dirtMesh) _applyAtlasToMesh(dirtMesh, 'dirt', t); } catch (e) {}
          try { if (typeof grassMesh !== 'undefined' && grassMesh) _applyAtlasToMesh(grassMesh, 'grass', t); } catch (e) {}
        });
        // also attempt to preload pirate face textures for Full mode
        try {
          pirateBackTexture = loader.load('./textures/back.png', (tt) => { try { tt.needsUpdate = true; } catch (e) {} finally { try { applyPirateTextures(); } catch (e) {} } });
        } catch (e) {}
        try {
          pirateChestTexture = loader.load('./textures/chest.png', (tt) => { try { tt.needsUpdate = true; } catch (e) {} finally { try { applyPirateTextures(); } catch (e) {} } });
        } catch (e) {}
      } catch (e) { console.warn('atlas load failed', e); }
    }

  // build occupancy map for solid blocks so we can cull internal faces
  const occupancy = {};
  for (const p of grassPositions) occupancy[`${p[0]},${p[1]},${p[2]}`] = true;
  for (const p of dirtPositions) occupancy[`${p[0]},${p[1]},${p[2]}`] = true;
  for (const p of stonePositions) occupancy[`${p[0]},${p[1]},${p[2]}`] = true;

  const grassMesh = buildVoxelMesh(grassPositions, matGrass, occupancy);
  const dirtMesh = buildVoxelMesh(dirtPositions, matDirt, occupancy);
  const stoneMesh = buildVoxelMesh(stonePositions, matStone, occupancy);

    // add to scene
    if (stoneMesh) {
      scene.add(stoneMesh);
      try { if (__atlasTex) _applyAtlasToMesh(stoneMesh, 'stone', __atlasTex); } catch (e) {}
    }
    if (dirtMesh) {
      scene.add(dirtMesh);
      try { if (__atlasTex) _applyAtlasToMesh(dirtMesh, 'dirt', __atlasTex); } catch (e) {}
    }
    if (grassMesh) {
      scene.add(grassMesh);
      try { if (__atlasTex) _applyAtlasToMesh(grassMesh, 'grass', __atlasTex); } catch (e) {}
    }

    // create a single water surface plane at the top of the sea level so water looks continuous
    let waterMesh = null;
    // detect if there is any water at all
    let hasWater = false;
    for (let k in raw) {
      if (raw[k] <= SEA_LEVEL) { hasWater = true; break; }
    }
  if (hasWater) {
      // Build an alpha mask texture (canvas) where pixels that correspond to water cells
      // are opaque and land cells are transparent. This lets the single water plane
      // only render above actual water and gives a clean shoreline.
      const canvas = document.createElement("canvas");
      const texSize = size; // 1 texel per map cell gives crisp edges
      canvas.width = texSize;
      canvas.height = texSize;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(texSize, texSize);
  // we observed a +1 X offset in the mask during testing; bake that in so
  // the alpha map lines up by default. If you ever need to tweak this,
  // change waterOffsetX / waterOffsetZ here.
  const waterOffsetX = 1; // user-verified fix (X+)
  const waterOffsetZ = 0;
      // map coordinates: ix = -half .. half-1  -> u = ix + half + offset
      //                 iz = -half .. half-1  -> v = iz + half + offset
      for (let iz = -half; iz < half; ++iz) {
        for (let ix = -half; ix < half; ++ix) {
          const sx = ix + half + waterOffsetX;
          const sy = iz + half + waterOffsetZ;
          // clamp to texture bounds
          if (sx < 0 || sx >= texSize || sy < 0 || sy >= texSize) continue;
          const idx = (sy * texSize + sx) * 4;
          const info = heightMap[`${ix},${iz}`];
          if (info && info.topType === "water") {
            // white (alpha 255)
            img.data[idx + 0] = 255;
            img.data[idx + 1] = 255;
            img.data[idx + 2] = 255;
            img.data[idx + 3] = 255;
          } else {
            // transparent
            img.data[idx + 0] = 0;
            img.data[idx + 1] = 0;
            img.data[idx + 2] = 0;
            img.data[idx + 3] = 0;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      const tex = new T.CanvasTexture(canvas);
      tex.magFilter = T.NearestFilter;
      tex.minFilter = T.NearestFilter;
      tex.needsUpdate = true;
      matWater.alphaMap = tex;
      matWater.transparent = true;

      const plane = new T.PlaneGeometry(size, size, 1, 1);
      // adjust UVs by half a texel so texel centers line up with block centers
      const halfTex = 0.5 / texSize;
      const uvAttr = plane.attributes.uv;
      for (let i = 0; i < uvAttr.count; ++i) {
        const u = uvAttr.getX(i) + halfTex;
        const v = uvAttr.getY(i) + halfTex;
        uvAttr.setXY(i, u, v);
      }
      uvAttr.needsUpdate = true;
      waterMesh = new T.Mesh(plane, matWater);
      // plane is X by Z, rotate to horizontal
      waterMesh.rotation.x = -Math.PI / 2;
      // place the plane at the top of the water blocks (sea level top face is at SEA_LEVEL + 1)
      waterMesh.position.y = SEA_LEVEL + 1 - 0.01; // small offset to reduce z-fighting with block tops
      scene.add(waterMesh);
    }

    return { grassMesh, dirtMesh, stoneMesh, waterMesh, half, heightMap, matWater, occupancy };
  }

  // Procedural skybox generator: night ocean with moon, stars, and clouds
  function createProceduralNightSkybox(renderer, faceSize) {
    faceSize = faceSize || 1024;
    // helper: create a canvas and 2D context
    function makeCanvas() {
      const c = document.createElement('canvas');
      c.width = faceSize; c.height = faceSize;
      return c;
    }

    // draw a sky face: sky gradient + stars + optional moon/cloudds
    function drawSky(ctx, w, h, opts) {
      opts = opts || {};
      // background gradient (deep night)
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#021026');
      g.addColorStop(0.5, '#021733');
      g.addColorStop(1, '#001022');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      // soft clouds: draw a few translucent ellipses with blur
      try {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = '#dfefff';
        ctx.filter = 'blur(18px)';
        const cloudCount = opts.clouds === false ? 0 : 6;
        for (let i = 0; i < cloudCount; ++i) {
          const cx = Math.random() * w;
          const cy = Math.random() * (h * 0.6);
          const rw = (0.15 + Math.random() * 0.3) * w;
          const rh = rw * (0.18 + Math.random() * 0.25);
          ctx.beginPath();
          ctx.ellipse(cx, cy, rw, rh, Math.random() * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.filter = 'none';
        ctx.restore();
      } catch (e) { /* ignore filter if unsupported */ }

      // stars
      const starCount = 450;
      for (let s = 0; s < starCount; ++s) {
        const x = Math.random() * w;
        const y = Math.random() * h * 0.85;
        const r = Math.random() * 1.4;
        const alpha = 0.6 + Math.random() * 0.5;
        ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // optional moon
      if (opts.moon) {
        const mx = opts.moon.x * w;
        const my = opts.moon.y * h;
        const mr = opts.moon.r * Math.min(w, h);
        // glow
        try { ctx.save(); ctx.filter = 'blur(20px)'; ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff9ee'; ctx.beginPath(); ctx.arc(mx, my, mr * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } catch (e) { }
        // moon body
        ctx.beginPath();
        const moonGrad = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
        moonGrad.addColorStop(0, '#fffef0');
        moonGrad.addColorStop(1, '#f2e9d8');
        ctx.fillStyle = moonGrad;
        ctx.arc(mx, my, mr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // draw an ocean face for bottom (negY) with horizon and moon reflection
    function drawOcean(ctx, w, h, moonOpts) {
      // dark ocean gradient
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#021733');
      g.addColorStop(1, '#000814');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // stars on ocean face too (so stars appear on all faces)
      const starCount = 220;
      for (let s = 0; s < starCount; ++s) {
        const x = Math.random() * w;
        const y = Math.random() * h * 0.9;
        const r = Math.random() * 1.2;
        const alpha = 0.45 + Math.random() * 0.6;
        ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // (waves removed) keep ocean darker and rely on moon reflection for realism
      // moon reflection: vertical soft streak
      if (moonOpts) {
        const mx = moonOpts.x * w;
        const my = moonOpts.y * h;
        const mr = moonOpts.r * Math.min(w, h);
        const reflWidth = mr * 0.9;
        try {
          ctx.save(); ctx.globalAlpha = 0.28; ctx.filter = 'blur(18px)';
          const lin = ctx.createLinearGradient(mx, my, mx, h);
          lin.addColorStop(0, 'rgba(255,255,230,0.8)');
          lin.addColorStop(1, 'rgba(255,255,230,0.0)');
          ctx.fillStyle = lin;
          ctx.fillRect(mx - reflWidth, my, reflWidth * 2, h - my);
          ctx.restore();
        } catch (e) { /* ignore */ }
      }
    }

    // build six canvases for cube faces: +X, -X, +Y, -Y, +Z, -Z
    const faces = [];
    // choose a moon position roughly in the front face +Z
    const moon = { x: 0.5, y: 0.28, r: 0.07 };
    // +X
    { const c = makeCanvas(); drawSky(c.getContext('2d'), faceSize, faceSize, { clouds: true }); faces.push(c); }
    // -X
    { const c = makeCanvas(); drawSky(c.getContext('2d'), faceSize, faceSize, { clouds: true }); faces.push(c); }
    // +Y (up) - darker, stars concentrated
    { const c = makeCanvas(); drawSky(c.getContext('2d'), faceSize, faceSize, { clouds: false, moon: false }); faces.push(c); }
    // -Y (down) - ocean with reflection
    { const c = makeCanvas(); drawOcean(c.getContext('2d'), faceSize, faceSize, moon); faces.push(c); }
    // +Z (front) - place moon here
    { const c = makeCanvas(); drawSky(c.getContext('2d'), faceSize, faceSize, { clouds: true, moon: moon }); faces.push(c); }
    // -Z (back)
    { const c = makeCanvas(); drawSky(c.getContext('2d'), faceSize, faceSize, { clouds: true }); faces.push(c); }

    // Create a CubeTexture from canvases
    const cubeTex = new T.CubeTexture(faces);
    cubeTex.needsUpdate = true;
    try { cubeTex.encoding = T.sRGBEncoding; } catch (e) {}

    // Optionally create PMREM for environment lighting
    try {
      const pmrem = new T.PMREMGenerator(renderer);
      const env = pmrem.fromCubemap(cubeTex);
      // dispose pmrem helper
      pmrem.dispose();
      return { background: cubeTex, environment: env.texture };
    } catch (e) {
      return { background: cubeTex, environment: null };
    }
  }

  // star reflection generator removed (debug/test feature)

  // world initialization (terrain, fish, initial spawns, HUD, player)
  function initWorld() {
    // generate terrain and place player
    const terr = generateTerrain(MAP_SIZE);
    terrainData = terr;

    // (no dynamic cube camera by default) keep water as a simple transparent plane

    // spawn fish after terrain exists
    if (terrainData && terrainData.heightMap) {
      // create a group to hold fish meshes so we can clear them easily
      if (fishGroup) try { scene.remove(fishGroup); } catch (e) {}
      fishGroup = new T.Group();
      scene.add(fishGroup);
      spawnFishes(FISH_COUNT);
      // spawn a bunch of pirates immediately so players see them without waiting
      try {
        // If Full mode wants to use an external hat model, prefer to wait until
        // the model has loaded so initial pirates show the model hat instead of
        // the procedural hat. We'll retry a few times with short delays.
        const spawnInitialPirates = (attemptsLeft) => {
          try {
            const isFull = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
            if (isFull && !pirateHatModel && attemptsLeft > 0) {
              setTimeout(() => spawnInitialPirates(attemptsLeft - 1), 300);
              return;
            }
            for (let i = 0; i < 5; ++i) spawnPirateAttempt();
          } catch (e) {}
        };
        spawnInitialPirates(6);
      } catch (e) {}
    }
    // initialize HUD and collectibles state
    try {
      initHUD();
      // remove any previous collectibles group and reset accumulator
      try { if (collectiblesGroup) { scene.remove(collectiblesGroup); } } catch (e) {}
      collectiblesGroup = null;
      collectibles = [];
      collectSpawnAcc = 0;
      updateHUD();
    } catch (e) {}
  }

  // decide whether to wait for models in Full mode before starting
  try {
    const isFullMode = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
    if (isFullMode) {
      showLoadingOverlay('Loading models...');
      Promise.all([pirateHatPromise, treasureChestPromise, alienHeadPromise, cutlassPromise]).then(() => {
        try { hideLoadingOverlay(); } catch (e) {}
        try { initWorld(); } catch (e) { console.warn('initWorld failed', e); }
      }).catch((e) => {
        try { hideLoadingOverlay(); } catch (e) {}
        try { initWorld(); } catch (e) { console.warn('initWorld failed', e); }
      });
    } else {
      initWorld();
    }
  } catch (e) { initWorld(); }

  

  // create a blocky, "Roblox-like" player made from simple boxes:
  // 2 legs, 1 torso, 2 arms, 1 head. We build the parts so the feet sit at y=0
  // in local space, then position the group so the feet align with the world
  // topSolid + 1 as before.
  function createBlockyPlayerMesh() {
    const g = new T.Group();
    // make the player's body a bit shinier to better match the alien head in Full mode
    // increase metalness and reduce roughness for a subtle glossy look
    const mat = new T.MeshStandardMaterial({ color: 0x888888, metalness: 0.35, roughness: 0.28 });

    // dimensions (kept compact so overall height is similar to the previous cube)
    const legH = 0.5, legW = 0.22, legD = 0.22;
    const torsoH = 0.7, torsoW = 0.6, torsoD = 0.32;
    const armH = torsoH, armW = 0.16, armD = 0.16;
    const headH = 0.4, headW = 0.44, headD = 0.44;

    // To get natural limb rotation pivots, translate limb geometry so the origin
    // sits at the top (shoulder/hip). That makes rotation around X swing legs/arms.
    // legs (origin at top of leg so rotation is at hip)
    const leftLegGeo = new T.BoxGeometry(legW, legH, legD);
    leftLegGeo.translate(0, -legH / 2, 0);
    const leftLeg = new T.Mesh(leftLegGeo, mat);
    leftLeg.position.set(-torsoW * 0.25, legH, 0);
    g.add(leftLeg);

    const rightLegGeo = new T.BoxGeometry(legW, legH, legD);
    rightLegGeo.translate(0, -legH / 2, 0);
    const rightLeg = new T.Mesh(rightLegGeo, mat);
    rightLeg.position.set(torsoW * 0.25, legH, 0);
    g.add(rightLeg);

    // torso (centered above legs)
    const torso = new T.Mesh(new T.BoxGeometry(torsoW, torsoH, torsoD), mat);
    torso.position.set(0, legH + torsoH / 2, 0);
    g.add(torso);

    // arms (origin at shoulder)
    const leftArmGeo = new T.BoxGeometry(armW, armH, armD);
    leftArmGeo.translate(0, -armH / 2, 0);
    const leftArm = new T.Mesh(leftArmGeo, mat);
    leftArm.position.set(-torsoW / 2 - armW / 2, legH + torsoH, 0);
    g.add(leftArm);

    const rightArmGeo = new T.BoxGeometry(armW, armH, armD);
    rightArmGeo.translate(0, -armH / 2, 0);
    const rightArm = new T.Mesh(rightArmGeo, mat);
    rightArm.position.set(torsoW / 2 + armW / 2, legH + torsoH, 0);
    g.add(rightArm);

    // head
    const isFull = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
    let head;
    if (isFull && alienHeadModel) {
      try {
        // clone the loaded alien head model and try to scale it to roughly match the blocky head size
        const modelClone = alienHeadModel.clone(true);
        // mark meshes so recolor routines skip them
        modelClone.traverse((c) => { try { if (c && c.isMesh) { c.userData = c.userData || {}; c.userData.isAlienHead = true; } } catch (e) {} });
        // compute bounding box and scale to target head dimensions
        try {
          const bb = new T.Box3().setFromObject(modelClone);
          const size = new T.Vector3(); bb.getSize(size);
          const targetY = headH || 0.4;
          const sx = targetY / (size.y || targetY);
          const sxw = (headW || 0.44) / (size.x || headW || 0.44);
          const sxd = (headD || 0.44) / (size.z || headD || 0.44);
          const s = Math.min(sx, sxw, sxd) * 0.95;
          // scale the alien head to 1.9x the original target size
          modelClone.scale.set(s * 1.9, s * 1.9, s * 1.9);
          // after scaling, recompute bbox and shift so the model base aligns with group origin
          const bb2 = new T.Box3().setFromObject(modelClone);
          modelClone.position.y -= bb2.min.y;
          // nudge the alien head forward and down for a better fit on the player
          try { modelClone.position.z += 0.092; modelClone.position.y -= 0.4; } catch (e) {}
        } catch (e) {}
        head = new T.Group();
        head.add(modelClone);
        head.position.set(0, legH + torsoH + headH / 2, 0);
        g.add(head);
      } catch (e) {
        // fallback to primitive head if anything fails
        head = new T.Mesh(new T.BoxGeometry(headW, headH, headD), mat);
        head.position.set(0, legH + torsoH + headH / 2, 0);
        g.add(head);
      }
    } else {
      head = new T.Mesh(new T.BoxGeometry(headW, headH, headD), mat);
      head.position.set(0, legH + torsoH + headH / 2, 0);
      g.add(head);

      // add simple eyeballs to the player head (only for non-full or when model missing)
      try {
        const eyeMat = new T.MeshStandardMaterial({ color: 0x000000 });
        const eyeSize = Math.min(headW, headH) * 0.12;
        const leftEye = new T.Mesh(new T.SphereGeometry(eyeSize, 8, 8), eyeMat);
        const rightEye = new T.Mesh(new T.SphereGeometry(eyeSize, 8, 8), eyeMat);
        // mark as eyes so coloring routines skip them
        try { leftEye.userData = leftEye.userData || {}; leftEye.userData.isEye = true; } catch (e) {}
        try { rightEye.userData = rightEye.userData || {}; rightEye.userData.isEye = true; } catch (e) {}
        leftEye.position.set(-headW * 0.16, 0.05 * headH, headD * 0.52);
        rightEye.position.set(headW * 0.16, 0.05 * headH, headD * 0.52);
        head.add(leftEye);
        head.add(rightEye);
      } catch (e) {}
    }

    // expose limb parts on the group for animation later
    g.leftLeg = leftLeg;
    g.rightLeg = rightLeg;
    g.leftArm = leftArm;
    g.rightArm = rightArm;
    g.torso = torso;
    g.head = head;

    return g;
  }

  const playerMesh = createBlockyPlayerMesh();
  scene.add(playerMesh);
  // compute player half-height from bounding box
  const bbox = new T.Box3().setFromObject(playerMesh);
  const pHeight = (bbox.max.y - bbox.min.y) || 1.0;
  const pHalf = pHeight / 2;
  // decide a spawn Y using the generated terrain's recorded topSolid
  const spawnInfo = terrainData && terrainData.heightMap ? terrainData.heightMap[`0,0`] : null;
  const centerHeight = generateHeight(0, 0);
  const spawnTop = spawnInfo && typeof spawnInfo.topSolid === "number" ? spawnInfo.topSolid : centerHeight;
  // position group so its feet sit at spawnTop + 1 (our parts were built with feet at y=0)
  // add pHalf so the group's center Y matches earlier single-box logic
  playerMesh.position.set(0, spawnTop + 1 + pHalf + PLAYER_Y_ADJUST, 0);
  // remove placeholder yellow cube if it exists
  if (mesh2) {
    try { scene.remove(mesh2); disposeObject(mesh2); } catch (e) {}
    mesh2 = null;
  }

  // set player reference
  player.mesh = playerMesh;
  player.velocity.set(0, 0, 0);
  // store computed half-height for collision math
  player.halfHeight = pHalf;
  // store spawn center Y (adjusted) for consistency
  player.spawnY = spawnTop + 1 + pHalf + PLAYER_Y_ADJUST;
  // groundOffset used as a fallback center Y when no terrain info exists
  // include PLAYER_Y_ADJUST so collision fallback matches spawn
  player.groundOffset = player.halfHeight + PLAYER_Y_ADJUST;
  player.onGround = true;
  ensureControls();

  // set a procedural night skybox background & environment if none provided
  try {
    const sky = createProceduralNightSkybox(renderer, 1024);
    if (sky && sky.background) {
      try { scene.background = sky.background; } catch (e) {}
      try { if (sky.environment) scene.environment = sky.environment; } catch (e) {}
    }
  } catch (e) {}

  // if we have a generated environment/PMREM, configure the water material
  try {
    const wmat = terrainData && terrainData.matWater ? terrainData.matWater : null;
    if (wmat) {
      try {
        // Revert water material back to the original prototype defaults
        // Keep a semi-transparent blue with depthWrite off so terrain shows through
        try { if (wmat.color) wmat.color.setHex(0x3366ff); else wmat.color = new T.Color(0x3366ff); } catch (e) {}
        wmat.transparent = true;
        try { wmat.opacity = 0.55; } catch (e) {}
        wmat.depthWrite = false;
        // restore default PBR values (no forced metallic reflections)
        try { wmat.metalness = 0.0; wmat.roughness = 1.0; } catch (e) {}
        wmat.side = T.DoubleSide;
        // (star reflection/emissive debug code removed)
      } catch (e) {}
    }
  } catch (e) {}

  // lights
  let ambientLight = new T.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  let dir = new T.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);
}

// --- Fish spawning & behavior ---
function spawnFishes(count) {
  if (!terrainData || !terrainData.heightMap) return;
  // clear existing
  fishes = [];
  if (fishGroup) {
    for (let i = fishGroup.children.length - 1; i >= 0; --i) {
      const c = fishGroup.children[i];
      try { fishGroup.remove(c); disposeObject(c); } catch (e) {}
    }
  }
  const half = terrainData.half || 0;
  // compute inset spawn bounds so fish spawn at least FISH_SPAWN_MARGIN away from edges
  const minX = -half + FISH_SPAWN_MARGIN;
  const maxX = half - 1 - FISH_SPAWN_MARGIN;
  const minZ = -half + FISH_SPAWN_MARGIN;
  const maxZ = half - 1 - FISH_SPAWN_MARGIN;
  const rangeX = Math.max(1, maxX - minX + 1);
  const rangeZ = Math.max(1, maxZ - minZ + 1);
  const attemptsLimit = count * 20;
  let tries = 0;
  while (fishes.length < count && tries < attemptsLimit) {
    tries++;
    // choose random coords inset from map edges to avoid escapes
    const ix = Math.floor(Math.random() * rangeX) + minX;
    const iz = Math.floor(Math.random() * rangeZ) + minZ;
    const info = terrainData.heightMap[`${ix},${iz}`];
    if (!info || info.topType !== "water") continue;
  // choose a vertical offset from the water surface for the fish
  const yOff = FISH_Y_OPTIONS[Math.floor(Math.random() * FISH_Y_OPTIONS.length)];
  // place fish relative to the column's recorded surface so they don't spawn inside blocks
  const surface = (typeof info.surface === 'number') ? info.surface : (SEA_LEVEL);
  const y = surface + yOff;
  // avoid spawning inside a solid block (safety check using occupancy)
  const occ = terrainData.occupancy;
  const spawnBlockY = Math.floor(y);
  if (occ && occ[`${ix},${spawnBlockY},${iz}`]) continue;
  // create a small low-poly fish mesh (group with body + tail)
  const m = createFishMesh(randomPastel());
    // place in center of cell
    m.position.set(ix + 0.5, y, iz + 0.5);
    fishGroup.add(m);
    // initial velocity: random horizontal heading
    const ang = Math.random() * Math.PI * 2;
    const vel = new T.Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(FISH_SPEED);
    fishes.push({ mesh: m, velocity: vel, prevPos: m.position.clone(), seed: Math.random() });
  }
}

function updateFishes(dt) {
  if (!fishes || fishes.length === 0 || !terrainData || !terrainData.heightMap) return;
  // temporary vectors
  const tmp = new T.Vector3();
  const desired = new T.Vector3();
  for (const f of fishes) {
    const pos = f.mesh.position;
    // cohesion: find neighbors
    let count = 0;
    const center = new T.Vector3();
    for (const o of fishes) {
      if (o === f) continue;
      const d2 = pos.distanceToSquared(o.mesh.position);
      if (d2 <= COHESION_RADIUS * COHESION_RADIUS) {
        center.add(o.mesh.position);
        count++;
      }
    }
    if (count > 0) {
      // compute average position of neighbors in XZ only so cohesion ignores Y
      center.multiplyScalar(1 / count);
      // ensure cohesion target has the same Y as this fish so vertical pull is zero
      center.y = pos.y;
      desired.subVectors(center, pos);
      // force zero vertical component (cohesion acts only in XZ)
      desired.y = 0;
      if (desired.lengthSq() > 1e-6) desired.normalize().multiplyScalar(FISH_SPEED);
      else desired.set(0, 0, 0);
      // blend current velocity toward desired (horizontal cohesion only)
      f.velocity.lerp(desired, Math.min(1, COHESION_STRENGTH * dt));
    } else {
      // small random jitter turn
      const turn = (Math.random() - 0.5) * FISH_JITTER * dt;
      // rotate around Y by small amount
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const vx = f.velocity.x * cos - f.velocity.z * sin;
      const vz = f.velocity.x * sin + f.velocity.z * cos;
      f.velocity.x = vx; f.velocity.z = vz;
    }
    // maintain speed horizontally
    tmp.copy(f.velocity);
    tmp.y = 0;
    if (tmp.lengthSq() > 1e-6) {
      tmp.normalize().multiplyScalar(FISH_SPEED);
      f.velocity.x = tmp.x; f.velocity.z = tmp.z;
    }

    // propose next position
    const next = f.mesh.position.clone().addScaledVector(f.velocity, dt);

    // collision / bounce detection: compare previous and next cell
    const prevColX = Math.floor(f.prevPos.x);
    const prevColZ = Math.floor(f.prevPos.z);
    const newColX = Math.floor(next.x);
    const newColZ = Math.floor(next.z);
    let collided = false;
    // collision / bounce detection using occupancy (x,y,z)
    const newBlockY = Math.floor(next.y);
    const occ = terrainData.occupancy;
    if (occ && occ[`${newColX},${newBlockY},${newColZ}`]) {
      // collided with a solid block at the destination cell
      collided = true;
      if (newColX !== prevColX && newColZ === prevColZ) {
        f.velocity.x = -f.velocity.x;
      } else if (newColZ !== prevColZ && newColX === prevColX) {
        f.velocity.z = -f.velocity.z;
      } else {
        f.velocity.x = -f.velocity.x;
        f.velocity.z = -f.velocity.z;
      }
      // recompute next from prev position using reflected velocity
      next.copy(f.prevPos).addScaledVector(f.velocity, dt);
    }

    // apply next position
    f.prevPos.copy(f.mesh.position);
    f.mesh.position.copy(next);

    // orient mesh to velocity for a nicer look
    const lookAt = f.mesh.position.clone().add(f.velocity);
    f.mesh.lookAt(lookAt);
    // tail wag: animate tail if present
    try {
      const tNow = (performance && performance.now) ? performance.now() * 0.002 : Date.now() * 0.002;
      const tail = f.mesh.userData && f.mesh.userData.tail;
      if (tail) {
        tail.rotation.y = Math.sin(tNow * 6 + (f.seed || 0) * 10) * 0.6;
      }
    } catch (e) {}
  }
}

function buildFull() {
  // For Full mode we reuse the Prototype build but enable the texture atlas
  // so materials are mapped from the provided `gametexture.png` atlas.
  try {
    // set a flag that generateTerrain will read to apply atlas mapping
    window.__USE_TEXTURE_ATLAS__ = true;
    buildPrototype();
  } catch (e) {
    console.warn('buildFull fallback to prototype failed:', e);
  }
}

// since we're animating, add OrbitControls
let controls = new OrbitControls(camera, renderer.domElement);

let lastTimestamp; // undefined to start

function animate(timestamp) {
  // Convert time change from milliseconds to seconds
  let timeDelta = 0.001 * (lastTimestamp ? timestamp - lastTimestamp : 0);
  lastTimestamp = timestamp;

  // update the scene...
  // @@Snippet:rotateGreen
  if (mesh1) mesh1.rotateY(0.8 * timeDelta);
  // @@Snippet:end
  // player movement & simple physics
  if (player && player.mesh) {
    // build input vector (reuse temporaries)
    _vMove.set((inputState.right ? 1 : 0) + (inputState.left ? -1 : 0), 0, (inputState.back ? 1 : 0) + (inputState.forward ? -1 : 0));

    if (_vMove.lengthSq() > 0.0001) {
      _vMove.normalize();
      // move relative to camera orientation on XZ
      camera.getWorldDirection(_camForward);
      _camForward.y = 0;
      _camForward.normalize();
      _camRight.crossVectors(_camForward, _upVec).normalize();

      _worldMove.set(0, 0, 0);
      _worldMove.addScaledVector(_camForward, -_vMove.z);
      _worldMove.addScaledVector(_camRight, _vMove.x);
      _worldMove.normalize();
      const speed = PLAYER_SPEED; // units per second
      player.mesh.position.addScaledVector(_worldMove, speed * timeDelta);
    }

    // jump & gravity
    const gravity = -9.8;
    if (inputState.jump && player.onGround) {
      player.velocity.y = 5.0;
      player.onGround = false;
    }
    player.velocity.y += gravity * timeDelta;
    player.mesh.position.y += player.velocity.y * timeDelta;

      // --- Swimming behavior ---
      // We use the global water plane (if present) at SEA_LEVEL + 1 to determine
      // whether the player's center is below the surface. Holding space (inputState.jump)
      // while under the water makes the player swim up. At the surface, holding space
      // makes the player bob on the surface. Releasing space causes them to sink.
      try {
  const hasWaterPlane = terrainData && terrainData.matWater;
  if (hasWaterPlane) {
          const waterPlaneY = SEA_LEVEL + 1 - 0.01; // same placement used when creating the plane
          const bobCenter = waterPlaneY + (player.halfHeight || 0.5) + PLAYER_Y_ADJUST;
          // use feet Y to decide whether player is actually in the water
          const feetY = player.mesh.position.y - (player.halfHeight || 0.5);
          // require the feet to be sufficiently below the water plane to
          // consider the player "submerged". Lower the threshold by 1.5
          // so the player must be deeper before swim mode engages.
          const submerged = feetY < (waterPlaneY - 1.5);
          // detect threshold crossing to spawn splashes when entering water
          try {
            const prev = player.prevSubmerged || false;
            if (!prev && submerged) {
              // spawn splash at player's XZ (a bit ahead of the feet)
              try { spawnSplashAt(player.mesh.position.x, player.mesh.position.z); } catch (e) {}
            }
            player.prevSubmerged = !!submerged;
          } catch (e) {}

          if (submerged) {
            // feet are sufficiently under the surface
            if (inputState.jump && player.mesh.position.y < waterPlaneY) {
              // swim up while holding space (only if center hasn't reached the surface)
              player.isSwimming = true;
              const swimAccel = 20.0; // stronger upward acceleration
              const swimMax = 4.0; // cap upward speed while swimming
              player.velocity.y = Math.min(player.velocity.y + swimAccel * timeDelta, swimMax);
            } else if (inputState.jump && player.mesh.position.y >= waterPlaneY) {
              // feet are in water but center reached surface -> bob on surface while holding space
              player.isSwimming = true;
              // lock vertical position to bobCenter (with a tiny sinusoidal bob)
              const tNow = (performance && performance.now) ? performance.now() : Date.now();
              const small = Math.sin(tNow * 0.004) * 0.03;
              player.mesh.position.y = bobCenter + small;
              player.velocity.y = 0;
            } else {
              // submerged but not holding jump -> stop swimming
              player.isSwimming = false;
            }
          } else {
            // feet are not submerged: force exit swim state even if jump is still held
            player.isSwimming = false;
          }
        }
      } catch (e) {}

    // ground collision using terrain data
    // We use the recorded topSolid for each column so that water columns (non-solid)
    // allow the player to sink until they reach the first solid block (stone/ground).
    let colX = Math.floor(player.mesh.position.x);
    let colZ = Math.floor(player.mesh.position.z);
    let targetCenterY = null;
    if (terrainData && terrainData.heightMap) {
      const info = terrainData.heightMap[`${colX},${colZ}`];
      if (info && typeof info.topSolid === "number") {
        // topSolid is the integer Y of the topmost solid block in the column
        // block occupies [y, y+1], so feet should be at y+1, and center at y+1 + halfHeight
        // include any global player center adjustment so collision matches spawn
        targetCenterY = info.topSolid + 1 + (player.halfHeight || 0.5) + PLAYER_Y_ADJUST;
      }
    }
    if (targetCenterY !== null) {
      if (player.mesh.position.y <= targetCenterY) {
        player.mesh.position.y = targetCenterY;
        player.velocity.y = 0;
        player.onGround = true;
      }
    } else {
      // fallback: ground plane at player's groundOffset (which includes any adjust)
      const bottomCenter = (typeof player.groundOffset === 'number') ? player.groundOffset : (player.halfHeight || 0.5) + PLAYER_Y_ADJUST;
      if (player.mesh.position.y <= bottomCenter) {
        player.mesh.position.y = bottomCenter;
        player.velocity.y = 0;
        player.onGround = true;
      }
    }

    // --- Facing & limb animation: make the character face movement and swing limbs ---
    try {
      const g = player.mesh;
      // Determine if user is providing movement input
      const movingInput = inputState.forward || inputState.back || inputState.left || inputState.right;
      // Smoothly rotate the player to face the world movement direction when moving.
      // _worldMove was set when input was present; if it's near-zero we skip rotating.
      if (g && typeof g.rotation !== 'undefined' && _worldMove.lengthSq() > 1e-6 && movingInput) {
        const targetYaw = Math.atan2(_worldMove.x, _worldMove.z);
        // shortest-path angle lerp
        const cur = g.rotation.y || 0;
        let diff = targetYaw - cur;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const rotSpeed = 12.0; // larger -> snappier
        g.rotation.y = cur + diff * Math.min(1, rotSpeed * timeDelta);
      }

      // Update walking phase accumulator
      if (movingInput) {
        player.walkTime = (player.walkTime || 0) + timeDelta * 6.0; // speed multiplier
      } else {
        // decay toward 0 for idle
        player.walkTime = (player.walkTime || 0) * Math.max(0, 1 - 6.0 * timeDelta);
      }

      // Limb animation: walking or swimming depending on state
      if (g && g.leftLeg && g.rightLeg && g.leftArm && g.rightArm) {
        if (player.isSwimming) {
          // swimming: arms point up and paddle, legs kick
          const t = (player.walkTime || 0);
          const kickFreq = 1.6;
          const kickAmp = 0.9;
          const paddleAmp = 0.6;
          // arms baseline pointing up (-PI/2), paddling around that pose
          g.leftArm.rotation.x = -Math.PI / 2 + Math.sin(t * kickFreq) * paddleAmp;
          g.rightArm.rotation.x = -Math.PI / 2 - Math.sin(t * kickFreq) * paddleAmp;
          // legs kick opposite-phase
          g.leftLeg.rotation.x = Math.sin(t * kickFreq) * kickAmp;
          g.rightLeg.rotation.x = -Math.sin(t * kickFreq) * kickAmp;
          // slight torso bob/tilt for motion
          if (g.torso) g.torso.rotation.x = Math.sin(t * kickFreq) * 0.06;
        } else {
          const t = player.walkTime || 0;
          const walkAmp = 0.6; // leg swing amplitude (radians)
          const armAmp = 0.35; // arm swing amplitude (radians)
          // legs opposite phase
          g.leftLeg.rotation.x = Math.sin(t) * walkAmp;
          g.rightLeg.rotation.x = -Math.sin(t) * walkAmp;
          // arms swing opposite to legs (counterphase) with smaller amplitude
          g.leftArm.rotation.x = -Math.sin(t) * armAmp;
          g.rightArm.rotation.x = Math.sin(t) * armAmp;
          if (g.torso) g.torso.rotation.x = 0;
        }
      }
    } catch (e) {
      // if anything goes wrong (non-blocky player), just skip animation
    }

    // keep camera looking at player
  // update fish simulation
  try { updateCollectibles(timeDelta); } catch (e) {}
  try { if (fishGroup) updateFishes(timeDelta); } catch (e) {}
  try { updateSplashes(timeDelta); } catch (e) {}
  controls.target.copy(player.mesh.position);
    controls.update();

    // (star-reflection animation removed)

    // player flash handling: revert color when timer expires
    try {
      if (player && player.mesh && player.flashTimer && player.flashTimer > 0) {
        player.flashTimer = Math.max(0, player.flashTimer - timeDelta);
        if (player.flashTimer <= 0) {
          setPlayerColor(0x888888);
        }
      }
    } catch (e) {}

    // beam timers and behavior
    try {
      // cooldown tick
      if (beamCooldown > 0) beamCooldown = Math.max(0, beamCooldown - timeDelta);

      if (beamActive) {
        beamTimer -= timeDelta;
        // compute segment from eye forward
        const tmp = getPlayerEyePosAndDir();
        const start = tmp.eye;
        const dir = tmp.dir;
        const end = start.clone().addScaledVector(dir, BEAM_LENGTH);

        // update beam meshes (we now have two cylindrical beams, one per eye)
        if (beamMesh) {
          // beam geometry is along +X locally, rotate +X to point direction
          const quat = new T.Quaternion();
          quat.setFromUnitVectors(new T.Vector3(1, 0, 0), dir);

          // try to find eye world positions (meshes marked with userData.isEye)
          const eyeStarts = [];
          try {
            if (player && player.mesh && player.mesh.head) {
              player.mesh.head.traverse((c) => {
                try {
                  if (c && c.userData && c.userData.isEye) {
                    const wp = new T.Vector3();
                    c.getWorldPosition(wp);
                    eyeStarts.push(wp);
                  }
                } catch (e) {}
              });
            }
          } catch (e) {}

          // fallback: fabricate two eye positions offset perpendicular to beam direction
          if (eyeStarts.length < 2) {
            const rightVec = new T.Vector3().crossVectors(dir, new T.Vector3(0, 1, 0)).normalize();
            // Use the primitive eye offset so Full-mode spacing matches Prototype exactly
            const PRIMITIVE_EYE_OFFSET = 0.4 * 0.18; // headW (0.4) * 0.18 => 0.072
            let offset = PRIMITIVE_EYE_OFFSET;
            eyeStarts.length = 0;
            eyeStarts.push(start.clone().addScaledVector(rightVec, -offset));
            eyeStarts.push(start.clone().addScaledVector(rightVec, offset));
          }

          // position each child beam to originate from each eye
          // If Full mode, nudge the start positions slightly forward so beams appear to exit the alien head
          try {
            const isFull = (typeof window !== 'undefined') && (window.__USE_TEXTURE_ATLAS__ || window.__FORCE_FULL__);
            const FULL_BEAM_FORWARD = 0.2; // forward nudge for Full mode
            if (isFull) {
              for (let k = 0; k < eyeStarts.length; ++k) {
                try { eyeStarts[k].addScaledVector(dir, FULL_BEAM_FORWARD); } catch (e) {}
              }
            }
          } catch (e) {}
          for (let bi = 0; bi < beamMesh.children.length; ++bi) {
            const child = beamMesh.children[bi];
            try {
              const es = eyeStarts[bi] || eyeStarts[0];
              child.quaternion.copy(quat);
              child.position.copy(es).addScaledVector(dir, BEAM_LENGTH * 0.5);
            } catch (e) {}
          }

          // collision test against pirates for each eye beam
          const killR = 0.75; const killR2 = killR * killR;
          const playerCenterY = (player && player.mesh) ? player.mesh.position.y : start.y;
          const minHitY = playerCenterY - 0.2;
          const maxHitY = playerCenterY + 1.4;
          for (let bi = 0; bi < eyeStarts.length; ++bi) {
            const sPos = eyeStarts[bi];
            const ePos = sPos.clone().addScaledVector(dir, BEAM_LENGTH);
            const sXZ = sPos.clone(); sXZ.y = 0;
            const eXZ = ePos.clone(); eXZ.y = 0;
            for (let i = pirates.length - 1; i >= 0; --i) {
              const p = pirates[i]; if (!p || !p.mesh) continue;
              const pos = p.mesh.position;
              if (pos.y < minHitY || pos.y > maxHitY) continue;
              const posXZ = pos.clone(); posXZ.y = 0;
              const d2 = pointToSegmentDistanceSq(posXZ, sXZ, eXZ);
              if (d2 <= killR2) {
                try { score += 5; updateHUD(); } catch (e) {}
                try { removePirateAtIndex(i); } catch (e) {}
                continue;
              }
            }
          }
        }

        // beam end
        if (beamTimer <= 0) {
          beamActive = false;
          beamCooldown = BEAM_COOLDOWN;
          if (beamMesh) { try { scene.remove(beamMesh); try { beamMesh.traverse((c)=>{ try{ disposeObject(c); }catch(e){} }); } catch(e){} try { disposeObject(beamMesh); } catch(e){} } catch (e) {} beamMesh = null; }
        }
      }
    } catch (e) {}
  }

  // now draw the scene
  // ensure pirates spawn/update regardless of player state
  try { updatePirates(timeDelta); } catch (e) {}

  renderer.render(scene, camera);
  // have an animation loop (stop requesting frames after game over)
  if (!gameOver) window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);
// --- wiring the page entrypoint ---
// The page can force Full-mode by setting `window.__FORCE_FULL__ = true` before
// this script runs (or by loading a tiny boot module which sets the flag and
// then imports this file). If not set, we build the Prototype (non-full) version.
function initializeFromUI() {
  // simple rebuild helper: choose Full vs Prototype based on the global flag
  function rebuild() {
    clearScene();
    try {
      if (window && window.__FORCE_FULL__) buildFull();
      else buildPrototype();
    } catch (e) {
      // if full build fails for any reason, fall back to prototype
      try { buildPrototype(); } catch (err) { console.warn('rebuild failed', err); }
    }
    // after building, point camera at player if available
    if (player && player.mesh) {
      controls.target.copy(player.mesh.position);
      controls.update();
    }
  }

  // initial build
  rebuild();
}

// Wait for DOM in case elements are not present immediately
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initializeFromUI);
} else initializeFromUI();