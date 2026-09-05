import { AerialPerspectiveEffect, PrecomputedTexturesLoader } from "@takram/three-atmosphere";
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from "@takram/three-clouds";
import { DataTextureLoader, parseUint8Array } from "@takram/three-geospatial";
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import {
  Data3DTexture, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, LoadingManager,
  NoColorSpace, NoToneMapping, RedFormat, RepeatWrapping,
  Texture, TextureLoader, Vector3,
  type Matrix4, type PerspectiveCamera, type Scene, type WebGLRenderer,
} from "three";
import { presentationSun, WORLD_QUALITY, type WorldEnvironment } from "./world-model";

/** Real scattering/cloud passes, kept outside the recorded route and provider imagery data. */
export class WorldAtmosphere {
  private readonly manager = new LoadingManager();
  private readonly textures = new Set<Texture>();
  private disposed = false;
  private composer?: EffectComposer;
  private aerial?: AerialPerspectiveEffect;
  private clouds?: CloudsEffect;
  private environment: WorldEnvironment;
  private readonly base = `${import.meta.env.BASE_URL}world-assets/`;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly worldToECEF: Matrix4,
    environment: WorldEnvironment,
    private readonly routeCeilingM = 0,
  ) { this.environment = environment; }

  async load(signal: AbortSignal) {
    signal.addEventListener("abort", () => this.dispose(), { once: true });
    const aerial = new AerialPerspectiveEffect(this.camera, {
      sky: true, sun: true, moon: false, ground: false,
      // Photos already contain baked lighting. Do not pretend to physically re-light their materials.
      sunLight: false, skyLight: false,
    });
    const clouds = new CloudsEffect(this.camera);
    // Art-directed weather belongs above the ride, not through the rider's line of sight.
    const cloudFloor = Math.max(2500, this.routeCeilingM + 1500);
    clouds.cloudLayers[0].altitude = cloudFloor;
    clouds.cloudLayers[1].altitude = cloudFloor + 300;
    clouds.cloudLayers[2].altitude = Math.max(7500, cloudFloor + 5000);
    this.aerial = aerial;
    this.clouds = clouds;
    aerial.worldToECEFMatrix.copy(this.worldToECEF);
    clouds.worldToECEFMatrix.copy(this.worldToECEF);
    const atmosphere = new Promise<void>((resolve, reject) => {
      const textures = new PrecomputedTexturesLoader({ format: "binary", higherOrderScattering: false }, this.manager)
        .setType(this.renderer).load(`${this.base}atmosphere`, () => resolve(), undefined, reject);
      for (const texture of Object.values(textures)) if (texture instanceof Texture) this.textures.add(texture);
      Object.assign(aerial, textures);
      Object.assign(clouds, textures);
    });
    const loadImage = (name: string) => new Promise<Texture>((resolve, reject) => {
      const texture = new TextureLoader(this.manager).load(`${this.base}clouds/${name}.png`, () => resolve(texture), undefined, reject);
      Object.assign(texture, { minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, colorSpace: NoColorSpace });
      this.textures.add(texture);
    });
    const loadShape = (name: string, size: number) => new Promise<Data3DTexture>((resolve, reject) => {
      const texture = new DataTextureLoader(Data3DTexture, parseUint8Array, {
        width: size, height: size, depth: size, format: RedFormat,
        minFilter: LinearFilter, magFilter: LinearFilter,
        wrapS: RepeatWrapping, wrapT: RepeatWrapping, wrapR: RepeatWrapping,
      }, this.manager).load(`${this.base}clouds/${name}.bin`, () => resolve(texture), undefined, reject);
      this.textures.add(texture);
    });
    try {
      const [, weather, shape, detail, turbulence] = await Promise.all([
        atmosphere, loadImage("local_weather"), loadShape("shape", CLOUD_SHAPE_TEXTURE_SIZE),
        loadShape("shape_detail", CLOUD_SHAPE_DETAIL_TEXTURE_SIZE), loadImage("turbulence"),
      ]);
      signal.throwIfAborted();
      if (this.disposed) throw new Error("Atmosphere disposed");
      clouds.localWeatherTexture = weather;
      clouds.shapeTexture = shape;
      clouds.shapeDetailTexture = detail;
      clouds.turbulenceTexture = turbulence;
      // Deterministic temporal dithering. This is sample noise, not environmental data or a claimed STBN asset.
      const data = new Uint8Array(128 * 128 * 64);
      let random = 712367;
      for (let i = 0; i < data.length; i++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; data[i] = random & 255; }
      const noise = new Data3DTexture(data, 128, 128, 64);
      noise.format = RedFormat;
      noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping;
      noise.needsUpdate = true;
      this.textures.add(noise);
      aerial.stbnTexture = noise;
      clouds.stbnTexture = noise;
      clouds.events.addEventListener("change", () => {
        aerial.overlay = clouds.atmosphereOverlay;
        aerial.shadow = clouds.atmosphereShadow;
        aerial.shadowLength = clouds.atmosphereShadowLength;
      });
      const composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
      this.composer = composer;
      this.renderer.toneMapping = NoToneMapping;
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new EffectPass(this.camera, clouds, aerial));
      composer.addPass(new EffectPass(this.camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
      this.update(this.environment);
    } catch (error) { this.dispose(); throw error; }
  }
  update(environment: WorldEnvironment) {
    this.environment = environment;
    const { aerial, clouds } = this;
    if (!aerial || !clouds) return;
    const quality = WORLD_QUALITY[environment.quality];
    const sun = new Vector3(...presentationSun(environment.light)).transformDirection(this.worldToECEF);
    aerial.sunDirection.copy(sun);
    clouds.sunDirection.copy(sun);
    clouds.qualityPreset = quality.cloudPreset;
    clouds.skipRendering = !quality.clouds || environment.clouds === 0;
    clouds.coverage = environment.clouds;
    clouds.localWeatherVelocity.set(environment.reducedMotion ? 0 : 0.00015, 0);
    clouds.shapeVelocity.setScalar(0);
    clouds.shapeDetailVelocity.setScalar(0);
    this.renderer.toneMappingExposure = environment.light === "blue" ? 2 : 1;
  }
  resize(width: number, height: number) { this.composer?.setSize(width, height); }
  render(deltaSeconds: number) { this.composer?.render(this.environment.reducedMotion ? 0 : deltaSeconds); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.abort();
    this.composer?.dispose();
    if (!this.composer) { this.aerial?.dispose(); this.clouds?.dispose(); }
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
  }
}
