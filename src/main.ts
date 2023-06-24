import * as THREE from 'three';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { noise } from '@chriscourses/perlin-noise';
import music_1_url from "./music/1.mp3?url";
import music_2_url from "./music/2.mp3?url";
import music_3_url from "./music/3.mp3?url";
import music_4_url from "./music/4.mp3?url";
import music_5_url from "./music/5.mp3?url";
import music_6_url from "./music/6.mp3?url";
import music_7_url from "./music/7.mp3?url";
import music_8_url from "./music/8.mp3?url";

const loading_div = document.querySelector<HTMLDivElement>("#loading")!;

THREE.DefaultLoadingManager.onLoad = () => {
  window.addEventListener("pointerdown", _ => {
    init_audio();
  }, { once: true });
  loading_div.innerText = "Click to start!";
}

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas });
// renderer.shadowMap.enabled = true;

const camera_1 = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
const camera_2 = camera_1.clone();

camera_1.position.set(0, 0, 5);
camera_1.lookAt(0, 0, 0);
camera_2.position.set(0, 0, -5);
camera_2.lookAt(0, 0, 0);

// camera_1.add(camera_2);

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
let audio_promises = [
  audioLoader.loadAsync(music_1_url),
  audioLoader.loadAsync(music_2_url),
  audioLoader.loadAsync(music_3_url),
  audioLoader.loadAsync(music_4_url),
  audioLoader.loadAsync(music_5_url),
  audioLoader.loadAsync(music_6_url),
  audioLoader.loadAsync(music_7_url),
  audioLoader.loadAsync(music_8_url),
];

let sound_objects_left: THREE.Audio<GainNode>[];
async function init_audio() {
  const audio_buffers = await Promise.all(audio_promises);

  // create an AudioListener and add it to the camera
  const listener = new THREE.AudioListener();
  camera_1.add(listener);

  // todo: different ears
  // const pannerOptions = { pan: -1 };
  // const panner = new StereoPannerNode(listener.context, pannerOptions);
  // listener.setFilter(panner);

  sound_objects_left = audio_buffers.map(buffer => {
    const sound_object = new THREE.Audio(listener);
    sound_object.setBuffer(buffer);
    sound_object.setLoop(true);
    sound_object.setVolume(0.0);
    sound_object.play();
    return sound_object;
  });

  loading_div.style.display = "none";
  requestAnimationFrame(every_frame);
}

let pos_1 = new THREE.Vector3();
let pos_2 = new THREE.Vector3();
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

let input_state = {
  left: false,
  right: false,
  up: false,
  down: false,
};

const input_to_keycode = {
  left: "KeyD ArrowLeft".split(' '),
  right: "KeyA ArrowRight".split(' '),
  up: "KeyW ArrowUp".split(' '),
  down: "KeyS ArrowDown".split(' '),
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
let variable_left_element = document.querySelector<HTMLDivElement>("#variable_1_left")!
let variable_right_element = document.querySelector<HTMLDivElement>("#variable_1_right")!

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

  players.rotateY(- movement_vector.x * delta_time);
  players.rotateX(- movement_vector.y * delta_time);

  players.children[0].getWorldPosition(pos_1);
  players.children[1].getWorldPosition(pos_2);

  let v1_1 = noise(pos_1.x, pos_1.y, pos_1.z);
  let v1_2 = noise(pos_2.x + .3, pos_2.z + .1, pos_2.y + .8);

  let v2_1 = noise(pos_1.y, pos_1.z, pos_1.x);
  let v2_2 = noise(pos_2.z + .1, pos_2.y + .8, pos_2.x + .3);


  sound_objects_left.forEach(x => x.setVolume(0));
  let sound_index = v1_1 * (sound_objects_left.length - 1);
  let sound_frac = sound_index % 1;
  if (Math.ceil(sound_index) === Math.floor(sound_index)) {
    // edge case
    sound_objects_left[Math.floor(sound_index)].setVolume(1);
  } else {
    sound_objects_left[Math.ceil(sound_index)].setVolume(sound_frac);
    sound_objects_left[Math.floor(sound_index)].setVolume(1 - sound_frac);
  }

  // temp, to be changed to sounds
  let col1_1 = new THREE.Color();
  col1_1.setHSL(v1_1, 1, .5);
  let col1_2 = new THREE.Color();
  col1_2.setHSL(v1_2, 1, .5);

  let col2_1 = new THREE.Color();
  col2_1.setHSL(v2_1, 1, .5);
  let col2_2 = new THREE.Color();
  col2_2.setHSL(v2_2, 1, .5);

  variable_left_element.style.backgroundColor = "#" + col2_1.getHexString();
  variable_right_element.style.backgroundColor = "#" + col2_2.getHexString();

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera_1.aspect = .5 * canvas.clientWidth / canvas.clientHeight;
    camera_1.updateProjectionMatrix();
    camera_2.aspect = .5 * canvas.clientWidth / canvas.clientHeight;
    camera_2.updateProjectionMatrix();
  }

  renderer.setClearColor(col1_1);
  renderer.setViewport(0, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissor(0, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissorTest(true);
  renderer.render(scene, camera_1);

  camera_2.position.copy(camera_1.position);
  camera_2.position.multiplyScalar(-1);
  camera_2.lookAt(0, 0, 0);

  renderer.setClearColor(col1_2);
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