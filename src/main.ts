import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

THREE.DefaultLoadingManager.onLoad = () => {
  requestAnimationFrame(every_frame);
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

const controls = new OrbitControls(camera_1, renderer.domElement);

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

{
  const sphere_texture = (new THREE.TextureLoader()).load("https://s3-us-west-2.amazonaws.com/s.cdpn.io/141228/earthmap1k.jpg");
  const sphere_geo = new THREE.SphereGeometry(1, 32, 16);
  const sphere_mat = new THREE.MeshPhongMaterial({
    map: sphere_texture,
  })
  const sphere = new THREE.Mesh(sphere_geo, sphere_mat);
  scene.add(sphere);
}



let last_time = 0;
function every_frame(cur_time: number) {
  // @ts-ignore
  let delta_time = (cur_time - last_time) * .001;
  last_time = cur_time;

  controls.update();

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera_1.aspect = .5 * canvas.clientWidth / canvas.clientHeight;
    camera_1.updateProjectionMatrix();
    camera_2.aspect = .5 * canvas.clientWidth / canvas.clientHeight;
    camera_2.updateProjectionMatrix();
  }

  renderer.setViewport(0, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissor(0, 0, canvas.clientWidth / 2, canvas.clientHeight);
  renderer.setScissorTest(true);
  renderer.render(scene, camera_1);

  camera_2.position.copy(camera_1.position);
  camera_2.position.multiplyScalar(-1);
  camera_2.lookAt(0, 0, 0);

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