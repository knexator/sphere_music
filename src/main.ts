import * as THREE from 'three';
import GUI from 'lil-gui';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { inverseLerp, lerp } from 'three/src/math/MathUtils.js';
import { noise } from '@chriscourses/perlin-noise';

let music_acid_urls = fromCount(8, k => {
  return new URL(`./music_acid/${k + 1}.mp3`, import.meta.url).href
})

let music_chords_urls = fromCount(8, k => {
  return new URL(`./music_chords/${k + 1}.mp3`, import.meta.url).href
})

let music_new_urls = fromCount(5, k => {
  return new URL(`./music_new/${k + 1}.mp3`, import.meta.url).href
})

const loading_div = document.querySelector<HTMLDivElement>("#loading")!;

THREE.DefaultLoadingManager.onLoad = () => {
  window.addEventListener("pointerdown", _ => {
    init_audio();
  }, { once: true });
  loading_div.innerText = "Click to start!";
}

const gui = new GUI();
const CONFIG = {
  music_1: "new",
  music_2: "none",
  fade_between_loops: false,
}
gui.add(CONFIG, 'fade_between_loops');
gui.add(CONFIG, 'music_1', ["chords", "acid", "wave", "new"]);
gui.add(CONFIG, 'music_2', ["none", "chords", "acid", "wave", "new"]);

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas });
// renderer.shadowMap.enabled = true;

// const camera_1 = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
const camera_1 = new THREE.OrthographicCamera();
const camera_2 = camera_1.clone();

camera_1.position.set(0, 0, 5);
camera_1.lookAt(0, 0, 0);
camera_2.position.set(0, 0, -5);
camera_2.lookAt(0, 0, 0);

const controls = new TrackballControls(camera_1, renderer.domElement);
controls.dynamicDampingFactor = .9;
controls.rotateSpeed = 5;
controls.noPan = true;


// ambient
{
  const color = 0xFFFFFF;
  const intensity = .1;
  const light = new THREE.AmbientLight(color, intensity);
  scene.add(light);
}

// sun
{
  const color = 0xFFFFFF;
  const intensity = 1;
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(3, 5, 4);
  scene.add(light);
}

// main sphere
{
  const sphere_texture = (new THREE.TextureLoader()).load("https://s3-us-west-2.amazonaws.com/s.cdpn.io/141228/earthmap1k.jpg");
  const sphere_geo = new THREE.SphereGeometry(1, 32, 16);
  const sphere_mat = new THREE.MeshPhongMaterial({
    map: sphere_texture,
  })
  const sphere = new THREE.Mesh(sphere_geo, sphere_mat);
  scene.add(sphere);
}

// load a sound and set it as the Audio object's buffer
const audioLoader = new THREE.AudioLoader();
let audio_acid_promises = music_acid_urls.map(url => audioLoader.loadAsync(url));
let audio_chords_promises = music_chords_urls.map(url => audioLoader.loadAsync(url));
let audio_new_promises = music_new_urls.map(url => audioLoader.loadAsync(url));

let sounds_new_left: GainNode[] = [];
let sounds_new_right: GainNode[] = [];
let sounds_acid_left: GainNode[] = [];
let sounds_acid_right: GainNode[] = [];
let sounds_chords_left: GainNode[] = [];
let sounds_chords_right: GainNode[] = [];

class FreqSound {
  gain_node: GainNode;
  oscillator_node: OscillatorNode;

  constructor(ear: StereoPannerNode,
    public is_second_variable: boolean,
  ) {
    const oscillator_node = ear.context.createOscillator();
    oscillator_node.type = is_second_variable ? "sine" : "triangle";
    oscillator_node.start();

    const gain_node = ear.context.createGain();
    gain_node.gain.value = 0.0;
    oscillator_node.connect(gain_node).connect(ear);

    this.gain_node = gain_node;
    this.oscillator_node = oscillator_node;
  }

  setValue(value: number) {
    this.oscillator_node.frequency.value = this.is_second_variable ? (Math.pow(2, -.6 + value * .6) * 440) : (Math.pow(2, value * .6) * 440);
  }

  setActive(val: boolean) {
    this.gain_node.gain.value = val ? .3 : 0;
  }
}

let sound_wave_1_left: FreqSound;
let sound_wave_1_right: FreqSound;
let sound_wave_2_left: FreqSound;
let sound_wave_2_right: FreqSound;

async function init_audio() {
  const audio_acid_buffers = await Promise.all(audio_acid_promises);
  const audio_chords_buffers = await Promise.all(audio_chords_promises);
  const audio_new_buffers = await Promise.all(audio_new_promises);

  const audio_ctx = new AudioContext();

  const audio_acid_sources = audio_acid_buffers.map(buffer => {
    const source = audio_ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  });

  const audio_chords_sources = audio_chords_buffers.map(buffer => {
    const source = audio_ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  })

  const audio_new_sources = audio_new_buffers.map(buffer => {
    const source = audio_ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  })

  const left_ear = audio_ctx.createStereoPanner();
  left_ear.pan.value = -1;
  left_ear.connect(audio_ctx.destination);

  const right_ear = audio_ctx.createStereoPanner();
  right_ear.pan.value = 1;
  right_ear.connect(audio_ctx.destination);

  sound_wave_1_left = new FreqSound(left_ear, false);
  sound_wave_1_right = new FreqSound(right_ear, false);

  sound_wave_2_left = new FreqSound(left_ear, true);
  sound_wave_2_right = new FreqSound(right_ear, true);


  sounds_acid_left = audio_acid_sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(left_ear);
    return gain_node;
  })

  sounds_acid_right = audio_acid_sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(right_ear);
    return gain_node;
  })

  sounds_chords_left = audio_chords_sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(left_ear);
    return gain_node;
  })

  sounds_chords_right = audio_chords_sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(right_ear);
    return gain_node;
  })

  sounds_new_left = audio_new_sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(left_ear);
    return gain_node;
  })

  sounds_new_right = audio_new_sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(right_ear);
    return gain_node;
  })

  loading_div.style.display = "none";
  requestAnimationFrame(every_frame);
}

let pos_left = new THREE.Vector3();
let pos_right = new THREE.Vector3();
const players = new THREE.Object3D();
scene.add(players);
{
  const players_geo = new THREE.PlaneGeometry(.1, .1);
  const player_1_mat = new THREE.MeshPhongMaterial({ color: "#FFD524" });
  const player_2_mat = new THREE.MeshPhongMaterial({ color: "#55185D" });
  player_2_mat.side = THREE.BackSide;

  const player_1 = new THREE.Mesh(players_geo, player_1_mat);
  const player_2 = new THREE.Mesh(players_geo, player_2_mat);

  player_1.add(new THREE.AxesHelper(.1));
  player_2.add(new THREE.AxesHelper(.1));

  player_1.position.setZ(1);
  player_2.position.setZ(-1);
  player_2.rotateX(Math.PI);
  player_2.rotateY(Math.PI);

  players.add(player_1, player_2);
}

// players.add(camera_1);

let input_state = {
  left: false,
  right: false,
  up: false,
  down: false,
  cw: false,
  ccw: false,
  precision: false,
  action_just_pressed: false,
};

const input_to_keycode = {
  cw: "KeyD ArrowLeft".split(' '),
  ccw: "KeyA ArrowRight".split(' '),
  up: "KeyW ArrowUp".split(' '),
  down: "KeyS ArrowDown".split(' '),
  left: "KeyE",
  right: "KeyQ",
  precision: "ShiftLeft ShiftRight".split(' '),
  action_just_pressed: "Space",
};

document.addEventListener("keydown", ev => {
  for (const [input, keycodes] of Object.entries(input_to_keycode)) {
    if (keycodes.includes(ev.code)) {
      // @ts-ignore
      input_state[input] = true;
    }
  }
});

document.addEventListener("keyup", ev => {
  for (const [input, keycodes] of Object.entries(input_to_keycode)) {
    if (keycodes.includes(ev.code)) {
      // @ts-ignore
      input_state[input] = false;
    }
  }
});

// temp, to be changed by sounds
// let variable_1_left_element = document.querySelector<HTMLDivElement>("#variable_1_left")!
// let variable_1_right_element = document.querySelector<HTMLDivElement>("#variable_1_right")!
let variable_2_left_element = document.querySelector<HTMLDivElement>("#variable_2_left")!
let variable_2_right_element = document.querySelector<HTMLDivElement>("#variable_2_right")!

function variable_1(pos: THREE.Vector3): number {
  return noise(pos.x + .2, pos.y + .3, pos.z + .4);
}

function variable_2(pos: THREE.Vector3): number {
  return noise(pos.z + .1, pos.y + .8, pos.x + .3);
}

let last_sign_1: number | null = null;
let last_sign_2: number | null = null;

let last_time = 0;
function every_frame(cur_time: number) {
  // @ts-ignore
  let delta_time = (cur_time - last_time) * .001;
  last_time = cur_time;

  controls.update();

  let movement_vector = new THREE.Vector2(
    Number(input_state.right) - Number(input_state.left),
    Number(input_state.up) - Number(input_state.down),
  );

  let rot = Number(input_state.ccw) - Number(input_state.cw);
  if (input_state.precision) {
    rot *= .2;
    movement_vector.multiplyScalar(.1);
  }

  players.rotateZ(rot * 4 * delta_time);
  players.rotateY(- movement_vector.x * delta_time);
  players.rotateX(- movement_vector.y * delta_time);

  players.children[0].getWorldPosition(pos_left);
  players.children[1].getWorldPosition(pos_right);

  let v1_left = variable_1(pos_left);
  let v2_left = variable_2(pos_left);
  let v1_right = variable_1(pos_right);
  let v2_right = variable_2(pos_right);

  // cheating until we get a better mapping
  v1_left = clamp(remap(v1_left, .25, .75, 0, 1), 0, 1);
  v2_left = clamp(remap(v2_left, .25, .75, 0, 1), 0, 1);
  v1_right = clamp(remap(v1_right, .25, .75, 0, 1), 0, 1);
  v2_right = clamp(remap(v2_right, .25, .75, 0, 1), 0, 1);

  let cur_sign_1 = Math.sign(v1_left - v1_right);
  let cur_sign_2 = Math.sign(v2_left - v2_right);
  if (last_sign_1 !== null && last_sign_1 !== cur_sign_1) {
    input_state.action_just_pressed = true;
  }
  if (last_sign_2 !== null && last_sign_2 !== cur_sign_2) {
    // input_state.action_just_pressed = true;
  }
  last_sign_1 = cur_sign_1;
  last_sign_2 = cur_sign_2;

  if (input_state.action_just_pressed) {
    input_state.action_just_pressed = false;
    const cur_markers = players.clone();
    cur_markers.children.forEach(x => x.scale.multiplyScalar(.5));
    scene.add(cur_markers);
  }

  const sounds_left = { "chords": sounds_chords_left, "acid": sounds_acid_left, "new": sounds_new_left };
  sounds_acid_left.forEach(x => x.gain.value = 0);
  sounds_chords_left.forEach(x => x.gain.value = 0);
  sounds_new_left.forEach(x => x.gain.value = 0);
  if (CONFIG.music_1 === "wave") {
    sound_wave_1_left.setActive(true);
    sound_wave_1_left.setValue(v1_left);
  } else {
    sound_wave_1_left.setActive(false);
    // @ts-ignore
    let cur_sounds_left = sounds_left[CONFIG.music_1];
    if (cur_sounds_left.length > 0) {
      let sound_index = v1_left * (cur_sounds_left.length - 1);
      let sound_frac = sound_index % 1;
      if (!CONFIG.fade_between_loops || Math.ceil(sound_index) === Math.floor(sound_index)) {
        // edge case - no fade
        cur_sounds_left[Math.floor(sound_index)].gain.value = 1;
      } else {
        cur_sounds_left[Math.ceil(sound_index)].gain.value = sound_frac;
        cur_sounds_left[Math.floor(sound_index)].gain.value = 1 - sound_frac;
      }
    }
  }

  if (CONFIG.music_2 === "wave") {
    sound_wave_2_left.setActive(true);
    sound_wave_2_left.setValue(v2_left);
  } else {
    sound_wave_2_left.setActive(false);
    if (CONFIG.music_2 !== "none" && CONFIG.music_2 !== CONFIG.music_1) {
      // @ts-ignore
      let cur_sounds_2_left = sounds_left[CONFIG.music_2];
      if (cur_sounds_2_left.length > 0) {
        let sound_index = v2_left * (cur_sounds_2_left.length - 1);
        let sound_frac = sound_index % 1;
        if (!CONFIG.fade_between_loops || Math.ceil(sound_index) === Math.floor(sound_index)) {
          // edge case - no fade
          cur_sounds_2_left[Math.floor(sound_index)].gain.value = 1;
        } else {
          cur_sounds_2_left[Math.ceil(sound_index)].gain.value = sound_frac;
          cur_sounds_2_left[Math.floor(sound_index)].gain.value = 1 - sound_frac;
        }
      }
    }
  }

  const sounds_right = { "chords": sounds_chords_right, "acid": sounds_acid_right, "new": sounds_new_right };
  sounds_acid_right.forEach(x => x.gain.value = 0);
  sounds_chords_right.forEach(x => x.gain.value = 0);
  sounds_new_right.forEach(x => x.gain.value = 0);
  if (CONFIG.music_1 === "wave") {
    sound_wave_1_right.setActive(true);
    sound_wave_1_right.setValue(v1_right);
  } else {
    sound_wave_1_right.setActive(false);
    // @ts-ignore
    let cur_sounds_right = sounds_right[CONFIG.music_1];
    if (cur_sounds_right.length > 0) {
      let sound_index = v1_right * (cur_sounds_right.length - 1);
      let sound_frac = sound_index % 1;
      if (!CONFIG.fade_between_loops || Math.ceil(sound_index) === Math.floor(sound_index)) {
        // edge case - no fade
        cur_sounds_right[Math.floor(sound_index)].gain.value = 1;
      } else {
        cur_sounds_right[Math.ceil(sound_index)].gain.value = sound_frac;
        cur_sounds_right[Math.floor(sound_index)].gain.value = 1 - sound_frac;
      }
    }
  }

  if (CONFIG.music_2 === "wave") {
    sound_wave_2_right.setActive(true);
    sound_wave_2_right.setValue(v2_right);
  } else {
    sound_wave_2_right.setActive(false);
    if (CONFIG.music_2 !== "none" && CONFIG.music_2 !== CONFIG.music_1) {
      // @ts-ignore
      let cur_sounds_2_right = sounds_right[CONFIG.music_2];
      if (cur_sounds_2_right.length > 0) {
        let sound_index = v2_right * (cur_sounds_2_right.length - 1);
        let sound_frac = sound_index % 1;
        if (!CONFIG.fade_between_loops || Math.ceil(sound_index) === Math.floor(sound_index)) {
          // edge case - no fade
          cur_sounds_2_right[Math.floor(sound_index)].gain.value = 1;
        } else {
          cur_sounds_2_right[Math.ceil(sound_index)].gain.value = sound_frac;
          cur_sounds_2_right[Math.floor(sound_index)].gain.value = 1 - sound_frac;
        }
      }
    }
  }

  // temp, to be changed to sounds
  let col_v1_left = new THREE.Color();
  col_v1_left.setHSL(v1_left, 1, .5);
  let col_v1_right = new THREE.Color();
  col_v1_right.setHSL(v1_right, 1, .5);

  let col_v2_left = new THREE.Color();
  col_v2_left.setHSL(v2_left, 1, .5);
  let col_v2_right = new THREE.Color();
  col_v2_right.setHSL(v2_right, 1, .5);

  variable_2_left_element.innerText = v2_left.toFixed(4);
  variable_2_right_element.innerText = v2_right.toFixed(4);
  variable_2_left_element.style.backgroundColor = "#" + col_v2_left.getHexString();
  variable_2_right_element.style.backgroundColor = "#" + col_v2_right.getHexString();

  if (resizeRendererToDisplaySize(renderer)) {
    // const canvas = renderer.domElement;
    // camera_1.aspect = .5 * canvas.clientWidth / canvas.clientHeight;
    // camera_1.updateProjectionMatrix();
    // camera_2.aspect = .5 * canvas.clientWidth / canvas.clientHeight;
    // camera_2.updateProjectionMatrix();
  }

  renderer.setClearColor(col_v1_left);
  renderer.setViewport(0, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissor(0, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissorTest(true);
  renderer.render(scene, camera_1);

  camera_2.rotation.copy(camera_1.rotation)
  camera_2.position.copy(camera_1.position);
  camera_2.position.multiplyScalar(-1);
  camera_2.rotateY(Math.PI);

  renderer.setClearColor(col_v1_right);
  renderer.setViewport(canvas.clientWidth / 2, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissor(canvas.clientWidth / 2, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissorTest(true);
  renderer.render(scene, camera_2);


  requestAnimationFrame(every_frame);
}


function resizeRendererToDisplaySize(renderer: THREE.WebGLRenderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
    // composer.setSize(width, height);
  }
  return needResize;
}

function clamp(value: number, a: number, b: number) {
  if (value < a) return a;
  if (value > b) return b;
  return value;
}

function remap(value: number, src_min: number, src_max: number, dst_min: number, dst_max: number): number {
  let t = inverseLerp(src_min, src_max, value);
  return lerp(dst_min, dst_max, t);
}

export function fromCount<T>(n: number, callback: (index: number) => T): T[] {
  let result = Array(n);
  for (let k = 0; k < n; k++) {
    result[k] = callback(k);
  }
  return result;
}
