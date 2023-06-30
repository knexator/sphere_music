import * as THREE from 'three';
import GUI from 'lil-gui';
import { inverseLerp, lerp } from 'three/src/math/MathUtils.js';
import anime from 'animejs';
import { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import model_rover_url from "./models/rover.glb?url"
import model_sonar_url from "./models/sonar.glb?url"
import model_beam_url from "./models/beam.glb?url"

const sound_counts = {
  acid: 8,
  chords: 8,
  new: 5,
  test_21: 6,
};

let GAME_STATE: "LOADING" | "PRESS_TO_START" | "CUTSCENE_1" | "FIRST_TRIP" | "WAITING_2" | "CUTSCENE_2" | "SECOND_TRIP" | "THIRD_TRIP" = "LOADING";

const sound_urls = objectMap(sound_counts, (count, key) => fromCount(count, k => {
  return new URL(`./music_${key}/${k + 1}.mp3`, import.meta.url).href
}));

const loading_div = document.querySelector<HTMLDivElement>("#loading")!;

let helper_canvas = document.createElement('canvas');
let helper_ctx = helper_canvas.getContext("2d")!;

const noise_img = document.querySelector<HTMLImageElement>("#noise_img")!;
helper_canvas.width = noise_img.width;
helper_canvas.height = noise_img.height;
helper_ctx.drawImage(noise_img, 0, 0);
var noise_data = helper_ctx.getImageData(0, 0, noise_img.width, noise_img.height);

function variables(pos: THREE.Vector3): [number, number] {
  let ang_x = Math.atan2(pos.z, pos.x);
  let ang_y = Math.atan2(pos.y, Math.sqrt(pos.x * pos.x + pos.z * pos.z));
  let u = remap(ang_x, -Math.PI, Math.PI, 0, 1);
  let v = remap(ang_y, -Math.PI / 2, Math.PI / 2, 0, 1);
  u = (u + .2) % 1;

  var tx = Math.min(u * noise_data.width | 0, noise_data.width - 1);
  var ty = Math.min(v * noise_data.height | 0, noise_data.height - 1);
  var offset = (ty * noise_data.width + tx) * 4;
  var r = noise_data.data[offset + 0] / 255;
  var g = noise_data.data[offset + 1] / 255;
  // var b = noise_data.data[offset + 2];
  // var a = noise_data.data[offset + 3];
  // return noise(pos.x + .2, pos.y + .3, pos.z + .4);
  return [g, r];
}

THREE.DefaultLoadingManager.onLoad = () => {
  window.addEventListener("pointerdown", _ => {
    init_audio();
  }, { once: true });
  GAME_STATE = "PRESS_TO_START";
  loading_div.innerText = "Click to start!\nUse headphones";
}

const gui = new GUI();
const CONFIG = {
  music_1: "test_21",
  music_2: "acid",
  fade_between_loops: true,
}
gui.add(CONFIG, 'fade_between_loops');
gui.add(CONFIG, 'music_1', ["wave", ...Object.keys(sound_counts)]);
gui.add(CONFIG, 'music_2', ["none", "wave", ...Object.keys(sound_counts)]);

const canvas_3d = document.querySelector<HTMLCanvasElement>('#c')!;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas_3d });
// renderer.shadowMap.enabled = true;

const canvas_ui = document.querySelector<HTMLCanvasElement>('#ui_canvas')!;
let ctx_ui = canvas_ui.getContext("2d")!;
canvas_ui.width = canvas_ui.clientWidth;
canvas_ui.height = canvas_ui.clientHeight;

const frustumSize = 2.1;
let aspect = .5 * renderer.domElement.clientWidth / renderer.domElement.clientHeight;
const camera_left = new THREE.OrthographicCamera(frustumSize * aspect / - 2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / - 2, 1, 8);
const camera_right = camera_left.clone();

console.log(aspect);
const magic_number = 1.05;

camera_left.position.set(5, 0, 0);
camera_left.lookAt(0, 0, 0);
camera_left.position.setZ(magic_number * aspect);

camera_right.position.set(5, 0, 0);
camera_right.lookAt(0, 0, 0);
camera_right.position.setZ(-magic_number * aspect)

let mouse_state = {
  moving_any_camera: false,
  moving_left_camera: false,
  drag_delta: new THREE.Vector2(0, 0),
}
window.addEventListener("pointerdown", ev => {
  if (GAME_STATE !== "CUTSCENE_1") {
    mouse_state.moving_any_camera = true;
    mouse_state.moving_left_camera = .5 > ev.offsetX / renderer.domElement.clientWidth;
  }
});
window.addEventListener("pointermove", ev => {
  mouse_state.drag_delta.set(ev.movementX, ev.movementY);
});
window.addEventListener("pointerup", _ev => {
  mouse_state.moving_any_camera = false;
})

// ambient
{
  const color = 0xFFFFFF;
  const intensity = .2;
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
  const sphere_geo = new THREE.SphereGeometry(1, 64, 32);
  const sphere_mat = new THREE.MeshPhongMaterial({
    map: sphere_texture,
  })
  const sphere = new THREE.Mesh(sphere_geo, sphere_mat);
  scene.add(sphere);
}

// load a sound and set it as the Audio object's buffer
const audioLoader = new THREE.AudioLoader();
const audio_promises = objectMap(sound_urls, (urls, _key) => urls.map(url => audioLoader.loadAsync(url)));

let sounds_left: Record<string, GainNode[]> = {};
let sounds_right: Record<string, GainNode[]> = {};

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

let cutscene_music_left = {
  t: 0,
};
let cutscene_music_right = {
  t: 0,
};

let cutscene_2_state = { t: 0 };

const gltfLoader = new GLTFLoader();
const rover_model_promise = gltfLoader.loadAsync(model_rover_url);
const sonar_model_promise = gltfLoader.loadAsync(model_sonar_url);
const beam_model_promise = gltfLoader.loadAsync(model_beam_url);
let rover_model: GLTF;
let sonar_model: GLTF;
let beam_model: GLTF;

async function init_audio() {
  const audio_buffers: Record<string, AudioBuffer[]> = {};
  for (const [key, value] of Object.entries(audio_promises)) {
    audio_buffers[key] = await Promise.all(value);
  }

  rover_model = await rover_model_promise;
  sonar_model = await sonar_model_promise;
  beam_model = await beam_model_promise;

  player_left = rover_model.scene.clone();
  player_right = rover_model.scene.clone();

  player_left.position.setZ(1);
  player_right.position.setZ(-1);
  player_right.rotateX(Math.PI);

  players.add(player_left, player_right);

  const audio_ctx = new AudioContext();

  const audio_sources = objectMap(audio_buffers, (buffers, _key) => buffers.map(buffer => {
    const source = audio_ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  }));

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

  sounds_left = objectMap(audio_sources, (sources, _key) => sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(left_ear);
    return gain_node;
  }));

  sounds_right = objectMap(audio_sources, (sources, _key) => sources.map(source => {
    const gain_node = audio_ctx.createGain();
    gain_node.gain.value = 0.0;
    source.connect(gain_node).connect(right_ear);
    return gain_node;
  }));

  loading_div.style.display = "none";
  GAME_STATE = "CUTSCENE_1";

  let cutscene_landing_left = {
    t: 0,
  };
  let cutscene_landing_right = {
    t: 0,
  };

  let cutscene_rotation = {
    t: 0,
    prev_t: 0,
  };

  let text_1 = "\n\n\nPlanet: Unknown\n\nMission: Find antipodal\nresonating points\n\nEquipment: Two mobile\nG-Wave detectors"
  anime({
    targets: cutscene_text_state,
    n_chars_shown: text_1.length,
    easing: "linear",
    duration: DEBUG_SKIP_CUTSCENE ? 10 : 3000,
    update(_anim) {
      ui_text_element.innerText = text_1.slice(0, cutscene_text_state.n_chars_shown);
    },
    complete(_anim) {
      anime({
        delay: DEBUG_SKIP_CUTSCENE ? 10 : 3400,
        complete(_anim2) {
          ui_text_element.innerText = "";
        }
      })
    },
  });

  anime({
    targets: cutscene_landing_left,
    t: 1,
    delay: DEBUG_SKIP_CUTSCENE ? 10 : 200,
    duration: DEBUG_SKIP_CUTSCENE ? 10 : 1000,
    easing: "easeOutQuad",
    update(_anim) {
      player_left.position.setZ(lerp(3, 1, cutscene_landing_left.t))
    },
    complete(_anim) {
      let [v1_left, _v2_left] = variables(pos_left);
      objectMap(sounds_left, (sounds, _key) => sounds.forEach(x => {
        x.gain.value = 0;
      }));

      anime({
        targets: cutscene_music_left,
        t: 1,
        easing: "linear",
        delay: 0,
        duration: DEBUG_SKIP_CUTSCENE ? 10 : 1200,
        update(_anim) {
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
                cur_sounds_left[Math.floor(sound_index)].gain.value = cutscene_music_left.t;
              } else {
                cur_sounds_left[Math.ceil(sound_index)].gain.value = cutscene_music_left.t * sound_frac;
                cur_sounds_left[Math.floor(sound_index)].gain.value = cutscene_music_left.t * (1 - sound_frac);
              }
            }
          }
        },
      })
    },
  });
  anime({
    targets: cutscene_landing_right,
    t: 1,
    delay: DEBUG_SKIP_CUTSCENE ? 10 : 2400,
    duration: DEBUG_SKIP_CUTSCENE ? 10 : 1000,
    easing: "easeOutQuad",
    update(_anim) {
      player_right.position.setZ(lerp(-3, -1, cutscene_landing_right.t))
    },
    complete(_anim) {
      player_left.attach(camera_left);
      player_right.attach(camera_right);
      let initial_left_z = camera_left.position.z;
      let initial_right_z = camera_right.position.z;

      let [v1_right, _v2_right] = variables(pos_right);
      anime({
        targets: cutscene_music_right,
        t: 1,
        easing: "linear",
        delay: 0,
        duration: DEBUG_SKIP_CUTSCENE ? 10 : 1200,
        update(_anim) {
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
                cur_sounds_right[Math.floor(sound_index)].gain.value = cutscene_music_right.t;
              } else {
                cur_sounds_right[Math.ceil(sound_index)].gain.value = cutscene_music_right.t * sound_frac;
                cur_sounds_right[Math.floor(sound_index)].gain.value = cutscene_music_right.t * (1 - sound_frac);
              }
            }
          }
        },
      })

      anime({
        targets: cutscene_rotation,
        t: 1,
        easing: "easeInOutSine",
        delay: DEBUG_SKIP_CUTSCENE ? 10 : 1600,
        duration: DEBUG_SKIP_CUTSCENE ? 10 : 1200,
        update(_anim) {
          let dt = cutscene_rotation.t - cutscene_rotation.prev_t;
          cutscene_rotation.prev_t = cutscene_rotation.t;
          camera_left.rotateY(-dt * Math.PI / 2);
          // x: 5, y: 0, z: -0.20 => x: 0, y: 0, z: 5
          camera_left.position.set(5 * Math.cos(cutscene_rotation.t * Math.PI / 2), 0, 5 * Math.sin(cutscene_rotation.t * Math.PI / 2) + initial_left_z * (1 - cutscene_rotation.t));

          camera_right.rotateY(dt * Math.PI / 2);
          // x: 5, y: 0, z: 0.20 => x: 0, y: 0, z: 5
          camera_right.position.set(5 * Math.cos(cutscene_rotation.t * Math.PI / 2), 0, 5 * Math.sin(cutscene_rotation.t * Math.PI / 2) + initial_right_z * (1 - cutscene_rotation.t));
        },
        complete(_anim) {
          scene.attach(camera_left);
          scene.attach(camera_right);
          anime({
            targets: cutscene_text_state,
            n_chars_shown: [0, text_mission_1.length],
            easing: "linear",
            duration: DEBUG_SKIP_CUTSCENE ? 10 : 3000,
            update(_anim) {
              ui_text_element.innerText = text_mission_1.slice(0, cutscene_text_state.n_chars_shown);
            },
            complete(_anim) {
              ui_text_element.innerText += "\n(0/3)"
            },
          });

          GAME_STATE = "FIRST_TRIP"
        },
      })
    },
  })

  requestAnimationFrame(every_frame);
}

let n_correctly_placed = 0;

let cutscene_text_state = {
  n_chars_shown: 0,
};

let text_mission_1 = "Mission 1/3:\nPress Space when the G-Waves are equal at both antipodes";
let text_waiting_2 = "\nGood job! Visit the Reconfiguring Beam to alter your detectors";
let text_cutscene_2 = "\nSwitching to B-Waves...";
let text_mission_2 = "Mission 2/3:\nPress Space when the B-Waves are equal at both antipodes";

const DEBUG_SKIP_CUTSCENE = false;
const DEBUG_AUTO_PLACE_1 = false;
const DEBUG_AUTO_PLACE_2 = false;

let pos_left = new THREE.Vector3();
let pos_right = new THREE.Vector3();
const players = new THREE.Object3D();
scene.add(players);

const beams = new THREE.Object3D();
scene.add(beams);

let player_left: THREE.Object3D;
let player_right: THREE.Object3D;

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
// let variable_2_left_element = document.querySelector<HTMLDivElement>("#variable_2_left")!
// let variable_2_right_element = document.querySelector<HTMLDivElement>("#variable_2_right")!

let ui_text_element = document.querySelector<HTMLDivElement>("#ui_text")!;

let tmp_vec_1 = new THREE.Vector3();
let tmp_quat_1 = new THREE.Quaternion();
function rotateCamera(cam: THREE.Camera, v: THREE.Vector2) {
  tmp_vec_1.set(1, 0, 0);
  tmp_vec_1.applyQuaternion(cam.quaternion);
  cam.position.applyAxisAngle(tmp_vec_1, -.2 * v.y);
  tmp_vec_1.set(0, 1, 0);
  tmp_vec_1.applyQuaternion(cam.quaternion);
  cam.position.applyAxisAngle(tmp_vec_1, -.2 * v.x);
  cam.up.copy(tmp_vec_1);
  cam.lookAt(0, 0, 0);
}

const BEAM_POS_1 = new THREE.Vector3(1, 0, 0);
const BEAM_POS_2 = new THREE.Vector3(1, 0, 0);

let last_sign_1: number | null = null;
let last_sign_2: number | null = null;

let ui_time = 0;

let last_time = 0;
function every_frame(cur_time: number) {
  // @ts-ignore
  let delta_time = (cur_time - last_time) * .001;
  last_time = cur_time;

  ui_time += delta_time;

  if (GAME_STATE !== "CUTSCENE_1") {
    if (mouse_state.moving_any_camera) {
      if (mouse_state.moving_left_camera) {
        rotateCamera(camera_left, new THREE.Vector2(mouse_state.drag_delta.x * delta_time, mouse_state.drag_delta.y * delta_time));
        rotateCamera(camera_right, new THREE.Vector2(mouse_state.drag_delta.x * delta_time, -mouse_state.drag_delta.y * delta_time));
      } else {
        rotateCamera(camera_right, new THREE.Vector2(mouse_state.drag_delta.x * delta_time, mouse_state.drag_delta.y * delta_time));
        rotateCamera(camera_left, new THREE.Vector2(mouse_state.drag_delta.x * delta_time, -mouse_state.drag_delta.y * delta_time));
      }
    }

    let rot = Number(input_state.ccw) - Number(input_state.cw);
    let movement_vector = new THREE.Vector2(
      Number(input_state.right) - Number(input_state.left),
      Number(input_state.up) - Number(input_state.down),
    );
    movement_vector.multiplyScalar(.5);
    rot *= .5;
    if (input_state.precision) {
      rot *= .2;
      movement_vector.multiplyScalar(.1);
    }

    players.rotateZ(rot * 4 * delta_time);
    players.rotateY(- movement_vector.x * delta_time);
    players.rotateX(- movement_vector.y * delta_time);
  }

  players.children[0].getWorldPosition(pos_left);
  players.children[1].getWorldPosition(pos_right);

  let [v1_left, v2_left] = variables(pos_left);
  let [v1_right, v2_right] = variables(pos_right);

  let cur_sign_1 = Math.sign(v1_left - v1_right);
  let cur_sign_2 = Math.sign(v2_left - v2_right);
  if (DEBUG_AUTO_PLACE_1 && last_sign_1 !== null && last_sign_1 !== cur_sign_1) {
    input_state.action_just_pressed = true;
  }
  if (DEBUG_AUTO_PLACE_2 && last_sign_2 !== null && last_sign_2 !== cur_sign_2) {
    input_state.action_just_pressed = true;
  }
  last_sign_1 = cur_sign_1;
  last_sign_2 = cur_sign_2;

  if (input_state.action_just_pressed && (GAME_STATE === "FIRST_TRIP" || GAME_STATE === "SECOND_TRIP")) {
    input_state.action_just_pressed = false;

    const cur_marker_left = sonar_model.scene.clone();
    player_left.getWorldPosition(cur_marker_left.position);
    player_left.getWorldQuaternion(tmp_quat_1);
    cur_marker_left.rotation.setFromQuaternion(tmp_quat_1);
    scene.add(cur_marker_left);

    const cur_marker_right = sonar_model.scene.clone();
    player_right.getWorldPosition(cur_marker_right.position);
    player_right.getWorldQuaternion(tmp_quat_1);
    cur_marker_right.rotation.setFromQuaternion(tmp_quat_1);
    scene.add(cur_marker_right);

    let glow_color = new THREE.Color(1, 0, 0);
    let correct_1 = Math.abs(v1_left - v1_right) < 0.05;
    let correct_2 = Math.abs(v2_left - v2_right) < 0.05;
    let correct = (GAME_STATE === "FIRST_TRIP" && correct_1) || (GAME_STATE === "SECOND_TRIP" && correct_2);
    if (correct) {
      glow_color = new THREE.Color(0, 1, 0);
      if (GAME_STATE === "SECOND_TRIP") {
        glow_color = new THREE.Color(0, 1, 1);
      }
      n_correctly_placed += 1;
      ui_text_element.innerText = `${text_mission_1}\n(${n_correctly_placed}/3)`;
      if (n_correctly_placed == 3) {
        if (GAME_STATE === "FIRST_TRIP") {
          GAME_STATE = "WAITING_2";
          // erase mission text
          anime({
            targets: cutscene_text_state,
            n_chars_shown: 0,
            duration: 800,
            easing: "linear",
            update(_anim) {
              ui_text_element.innerText = text_mission_1.slice(0, cutscene_text_state.n_chars_shown);
            },
            complete(_anim) {
              // spawn the beam
              let beam_left = beam_model.scene.clone();
              beam_left.position.copy(BEAM_POS_1);
              beam_left.lookAt(0, 0, 0);
              beam_left.rotateX(Math.PI);
              let beam_right = beam_left.clone();
              beam_right.position.multiplyScalar(-1);
              beam_right.rotateX(Math.PI);
              beams.add(beam_left, beam_right);

              // waiting text "go to the beam"
              anime({
                targets: cutscene_text_state,
                n_chars_shown: [0, text_waiting_2.length],
                easing: "linear",
                duration: 1400,
                update(_anim) {
                  ui_text_element.innerText = text_waiting_2.slice(0, cutscene_text_state.n_chars_shown);
                },
              });
            },
          })
        } else if (GAME_STATE === "SECOND_TRIP") {
        }
      }
    } else {
      anime({
        delay: 1000,
        targets: cur_marker_left.scale,
        x: .1,
        y: .1,
        z: .1,
        duration: 1200,
        complete(_anim) {
          scene.remove(cur_marker_left);
        },
      })
      anime({
        delay: 1000,
        targets: cur_marker_right.scale,
        x: .1,
        y: .1,
        z: .1,
        duration: 1200,
        complete(_anim) {
          scene.remove(cur_marker_right);
        },
      })
    }
    // @ts-ignore
    let cur_marker_left_mat = cur_marker_left.children[0].children[2].material.clone() as MeshStandardMaterial;
    cur_marker_left_mat.emissive = glow_color;
    cur_marker_left_mat.color = glow_color;
    cur_marker_left_mat.emissiveIntensity = 1;
    // @ts-ignore
    cur_marker_left.children[0].children[2].material = cur_marker_left_mat
    // @ts-ignore
    let cur_marker_right_mat = cur_marker_right.children[0].children[2].material.clone() as MeshStandardMaterial;
    cur_marker_right_mat.emissive = glow_color;
    cur_marker_right_mat.color = glow_color;
    cur_marker_right_mat.emissiveIntensity = 1;
    // @ts-ignore
    cur_marker_right.children[0].children[2].material = cur_marker_right_mat
  }

  if (GAME_STATE === "WAITING_2") {
    player_left.getWorldPosition(tmp_vec_1);
    let dist_left = tmp_vec_1.distanceTo(BEAM_POS_1);
    player_right.getWorldPosition(tmp_vec_1);
    let dist_right = tmp_vec_1.distanceTo(BEAM_POS_1);
    if (Math.min(dist_left, dist_right) < .07) {
      GAME_STATE = "CUTSCENE_2";
      // hide the beam
      let beam_hiding_state = { t: 0 };
      anime({
        targets: beam_hiding_state,
        t: [0, 1],
        duration: 800,
        update(_anim) {
          let s = 1 - beam_hiding_state.t;
          beams.children.forEach(beam => beam.scale.set(s, s, s));
        },
        complete(_anim) {
          while (beams.children.length > 0) {
            beams.remove(beams.children[0])
          }
        },
      })

      // cutscene text "switching to o-waves"
      anime({
        targets: cutscene_text_state,
        n_chars_shown: [0, text_cutscene_2.length],
        easing: "linear",
        duration: 1200,
        update(_anim) {
          ui_text_element.innerText = text_cutscene_2.slice(0, cutscene_text_state.n_chars_shown);
        },
      });

      // change waves
      anime({
        targets: cutscene_2_state,
        t: [0, 1],
        delay: 1600,
        duration: 1500,
        easing: "linear",
        complete(_anim) {
          GAME_STATE = "SECOND_TRIP";
          n_correctly_placed = 0;
          anime({
            targets: cutscene_text_state,
            n_chars_shown: [0, text_mission_2.length],
            easing: "linear",
            duration: DEBUG_SKIP_CUTSCENE ? 10 : 3000,
            update(_anim) {
              ui_text_element.innerText = text_mission_2.slice(0, cutscene_text_state.n_chars_shown);
            },
            complete(_anim) {
              ui_text_element.innerText += "\n(0/3)"
            },
          });
        },
      })
    }
  }

  let var_1_sound = 0;
  let var_2_sound = 0;
  switch (GAME_STATE) {
    case "FIRST_TRIP":
      var_1_sound = 1;
      break;
    case "WAITING_2":
      var_1_sound = 1;
      break;
    case "SECOND_TRIP":
      var_2_sound = 1;
      break;
    case "CUTSCENE_2":
      if (cutscene_2_state.t < .5) {
        var_1_sound = 1 - cutscene_2_state.t * 2;
      } else {
        var_2_sound = (cutscene_2_state.t - .5) * 2;
      }
      break;
    default:
      break;
  }
  if (GAME_STATE !== "CUTSCENE_1") {
    objectMap(sounds_left, (sounds, _key) => sounds.forEach(x => {
      x.gain.value = 0;
    }));
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
          cur_sounds_left[Math.floor(sound_index)].gain.value = var_1_sound;
        } else {
          cur_sounds_left[Math.ceil(sound_index)].gain.value = var_1_sound * sound_frac;
          cur_sounds_left[Math.floor(sound_index)].gain.value = var_1_sound * (1 - sound_frac);
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
            cur_sounds_2_left[Math.floor(sound_index)].gain.value = var_2_sound;
          } else {
            cur_sounds_2_left[Math.ceil(sound_index)].gain.value = var_2_sound * sound_frac;
            cur_sounds_2_left[Math.floor(sound_index)].gain.value = var_2_sound * (1 - sound_frac);
          }
        }
      }
    }

    objectMap(sounds_right, (sounds, _key) => sounds.forEach(x => {
      x.gain.value = 0;
    }));
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
          cur_sounds_right[Math.floor(sound_index)].gain.value = var_1_sound;
        } else {
          cur_sounds_right[Math.ceil(sound_index)].gain.value = var_1_sound * sound_frac;
          cur_sounds_right[Math.floor(sound_index)].gain.value = var_1_sound * (1 - sound_frac);
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
            cur_sounds_2_right[Math.floor(sound_index)].gain.value = var_2_sound;
          } else {
            cur_sounds_2_right[Math.ceil(sound_index)].gain.value = var_2_sound * sound_frac;
            cur_sounds_2_right[Math.floor(sound_index)].gain.value = var_2_sound * (1 - sound_frac);
          }
        }
      }
    }
  }

  ctx_ui.clearRect(0, 0, canvas_ui.width, canvas_ui.height);
  const bg_gradient = ctx_ui.createLinearGradient(0, 0, 0, canvas_ui.height);
  bg_gradient.addColorStop(0, "#0B91C6");
  bg_gradient.addColorStop(1, "#0F4DA4");
  ctx_ui.fillStyle = bg_gradient;
  ctx_ui.fillRect(0, 0, canvas_ui.width, canvas_ui.height);


  // ctx_ui.fillStyle =
  // ctx_ui.fillRect
  ctx_ui.strokeStyle = "lime";
  if (GAME_STATE === "SECOND_TRIP" || (GAME_STATE === "CUTSCENE_2" && cutscene_2_state.t >= .5)) {
    ctx_ui.strokeStyle = "cyan";
  }

  let hw = canvas_ui.width / 2;
  let h = canvas_ui.height;

  ctx_ui.lineWidth = 3;

  ctx_ui.beginPath();
  for (let x = 0; x < hw; x++) {
    let y = wave_1_ui((x - hw / 2), ui_time, v1_left);

    if (GAME_STATE === "CUTSCENE_1") {
      let x_helper = remap(Math.abs(x - hw / 2), 0, hw / 2, 2, .1);
      x_helper = Math.pow(x_helper, 10);
      x_helper = clamp(x_helper + cutscene_music_left.t * cutscene_music_left.t, 0, 1);
      y *= cutscene_music_left.t * x_helper;
    } else if (GAME_STATE === "CUTSCENE_2") {
      if (cutscene_2_state.t < .5) {
        y *= 1 - cutscene_2_state.t * 2;
      } else {
        y = wave_2_ui((x - hw / 2), ui_time, v2_left);
        y *= (cutscene_2_state.t - .5) * 2;
      }
    } else if (GAME_STATE === "SECOND_TRIP") {
      y = wave_2_ui((x - hw / 2), ui_time, v2_left);
    }

    y = remap(y, -2, 2, 0, h);
    if (x == 0) {
      ctx_ui.moveTo(x, y);
    } else {
      ctx_ui.lineTo(x, y);
    }
  }
  ctx_ui.stroke();

  ctx_ui.beginPath();
  for (let x = 0; x < hw; x++) {
    let y = wave_1_ui((x - hw / 2), -ui_time, v1_right);

    if (GAME_STATE === "CUTSCENE_1") {
      let x_helper = remap(Math.abs(x - hw / 2), 0, hw / 2, 2, .1);
      x_helper = Math.pow(x_helper, 10);
      x_helper = clamp(x_helper + cutscene_music_right.t * cutscene_music_right.t, 0, 1);
      y *= cutscene_music_right.t * x_helper;
    } else if (GAME_STATE === "CUTSCENE_2") {
      if (cutscene_2_state.t < .5) {
        y *= 1 - cutscene_2_state.t * 2;
      } else {
        y = wave_2_ui((x - hw / 2), -ui_time, v2_right);
        y *= (cutscene_2_state.t - .5) * 2;
      }
    } else if (GAME_STATE === "SECOND_TRIP") {
      y = wave_2_ui((x - hw / 2), -ui_time, v2_right);
    }

    y = remap(y, -2, 2, 0, h);
    if (x == 0) {
      ctx_ui.moveTo(x + hw, y);
    } else {
      ctx_ui.lineTo(x + hw, y);
    }
  }
  ctx_ui.stroke();

  ctx_ui.fillStyle = middle_gradient;
  ctx_ui.fillRect(hw - hm, 0, hm * 2, canvas_ui.height);

  ctx_ui.fillStyle = top_gradient
  ctx_ui.fillRect(0, 0, canvas_ui.width, 20);

  ctx_ui.fillStyle = bottom_gradient
  ctx_ui.fillRect(0, canvas_ui.height - 20, canvas_ui.width, 20);


  // temp, to be changed to sounds
  // let col_v1_left = new THREE.Color();
  // col_v1_left.setHSL(v1_left, 1, .5);
  // let col_v1_right = new THREE.Color();
  // col_v1_right.setHSL(v1_right, 1, .5);

  // let col_v2_left = new THREE.Color();
  // col_v2_left.setHSL(v2_left, 1, .5);
  // let col_v2_right = new THREE.Color();
  // col_v2_right.setHSL(v2_right, 1, .5);

  // variable_2_left_element.innerText = v2_left.toFixed(4);
  // variable_2_right_element.innerText = v2_right.toFixed(4);
  // variable_2_left_element.style.backgroundColor = "#" + col_v2_left.getHexString();
  // variable_2_right_element.style.backgroundColor = "#" + col_v2_right.getHexString();

  if (resizeRendererToDisplaySize(renderer)) {
    let aspect = .5 * renderer.domElement.clientWidth / renderer.domElement.clientHeight;
    camera_left.left = -frustumSize * aspect / 2;
    camera_left.right = frustumSize * aspect / 2;
    camera_left.top = frustumSize / 2;
    camera_left.bottom = -frustumSize / 2;
    camera_right.left = -frustumSize * aspect / 2;
    camera_right.right = frustumSize * aspect / 2;
    camera_right.top = frustumSize / 2;
    camera_right.bottom = -frustumSize / 2;

    camera_left.updateProjectionMatrix();
    camera_right.updateProjectionMatrix();

    canvas_ui.width = canvas_ui.clientWidth;
    canvas_ui.height = canvas_ui.clientHeight;
  }

  // renderer.setClearColor(col_v1_left);
  renderer.setViewport(0, 0, canvas_3d.clientWidth / 2, canvas_3d.clientHeight);
  renderer.setScissor(0, 0, canvas_3d.clientWidth / 2, canvas_3d.clientHeight);
  renderer.setScissorTest(true);
  renderer.render(scene, camera_left);

  // renderer.setClearColor(col_v1_right);
  renderer.setViewport(canvas_3d.clientWidth / 2, 0, canvas_3d.clientWidth / 2, canvas_3d.clientHeight);
  renderer.setScissor(canvas_3d.clientWidth / 2, 0, canvas_3d.clientWidth / 2, canvas_3d.clientHeight);
  renderer.setScissorTest(true);
  renderer.render(scene, camera_right);

  mouse_state.drag_delta.set(0, 0);
  requestAnimationFrame(every_frame);
}

function wave_1_ui(x: number, t: number, value: number) {
  let main_freq = remap(1 / (value + 1), .5, 1, .03, .25);

  let freqs = [main_freq, .12, .08];
  let phases = [0, .1, -.1];
  let speeds = [10, 15, 30];
  let amplitudes = [1, .3, .05];
  let y = 0;
  for (let k = 0; k < 3; k++) {
    y += amplitudes[k] * Math.sin(x * freqs[k] + phases[k] + speeds[k] * t);
  }
  return y;
}

function wave_2_ui(x: number, t: number, value: number) {
  let main_freq = remap(1 / (value + 1), .5, 1, .02, .20);

  let freqs = [main_freq, .3, .1];
  let phases = [0, .2, -.3];
  let speeds = [8, 45, 20];
  let amplitudes = [1, remap(value, 0, 1, .05, .2), .3];
  let y = 0;
  for (let k = 0; k < 3; k++) {
    y += amplitudes[k] * Math.sin(x * freqs[k] + phases[k] + speeds[k] * t);
  }
  return y;
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

let hw = canvas_ui.width / 2;
const hm = 120; // half of middle
const middle_gradient = ctx_ui.createLinearGradient(hw - hm, 0, hw + hm, 0);
middle_gradient.addColorStop(0, "green");
middle_gradient.addColorStop(.02, "cyan");
middle_gradient.addColorStop(.04, "darkcyan");
middle_gradient.addColorStop(.08, "#757575");
middle_gradient.addColorStop(1 - .08, "#757575");
middle_gradient.addColorStop(1 - .04, "darkcyan");
middle_gradient.addColorStop(1 - .02, "cyan");
middle_gradient.addColorStop(1 - 0, "green");

const top_gradient = ctx_ui.createLinearGradient(0, 0, 0, 20);
top_gradient.addColorStop(0, "green");
top_gradient.addColorStop(0.4, "cyan");
top_gradient.addColorStop(0.6, "darkcyan");
top_gradient.addColorStop(1, "darkgreen");

const bottom_gradient = ctx_ui.createLinearGradient(0, canvas_ui.height - 20, 0, canvas_ui.height);
bottom_gradient.addColorStop(0, "green");
bottom_gradient.addColorStop(0.4, "cyan");
bottom_gradient.addColorStop(0.6, "darkcyan");
bottom_gradient.addColorStop(1, "darkgreen");

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

// returns a new object with the values at each key mapped using mapFn(value)
function objectMap<T, S>(object: Record<string, T>, mapFn: (val: T, key: string) => S): Record<string, S> {
  return Object.keys(object).reduce(function (result, key) {
    // @ts-ignore
    result[key] = mapFn(object[key], key)
    return result
  }, {})
}