import { Color, DataUtils, Group, HalfFloatType, Mesh, MeshBasicMaterial, NoToneMapping, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
import { EffectComposer, RenderPass } from "postprocessing";
import { withWorldTerrainFallback } from "../../src/surfaces/replay/world/world-terrain-composite";

export function verifyTerrainComposite() {
  const renderer=new WebGLRenderer({antialias:false,stencil:true});
  renderer.setSize(128,128);renderer.setClearColor(new Color(0,0,0),0);renderer.toneMapping=NoToneMapping;
  document.body.append(renderer.domElement);
  const scene=new Scene(),live=new Group(),nested=new Group(),retained=new Group();
  live.add(nested);scene.add(live,retained);
  const camera=new OrthographicCamera(-2,2,2,-2,.1,20);camera.position.z=5;camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const green=new MeshBasicMaterial({color:0x00ff00}),red=new MeshBasicMaterial({color:0xff0000}),blue=new MeshBasicMaterial({color:0x0000ff});
  const fine=new Mesh(new PlaneGeometry(2,4),green);fine.position.x=-1;nested.add(fine);
  // A nearer, stale surface MUST NOT obscure the new fine surface.
  const old=new Mesh(new PlaneGeometry(4,4),red);old.position.z=1;retained.add(old);
  const route=new Mesh(new PlaneGeometry(.3,.3),blue);route.position.set(.5,0,2);scene.add(route);
  const target=new WebGLRenderTarget(128,128,{stencilBuffer:true});
  const read=(buffer:WebGLRenderTarget,half=false)=>{
    const data=half?new Uint16Array(128*128*4):new Uint8Array(128*128*4);
    renderer.readRenderTargetPixels(buffer,0,0,128,128,data);
    return [32,80,112].map(x=>[0,1,2].map(c=>{
      const v=data[(64*128+x)*4+c];return Math.round((half?DataUtils.fromHalfFloat(v):v/255)*255);
    }));
  };
  let composer:EffectComposer|undefined;
  try {
    scene.updateMatrixWorld(true);renderer.setRenderTarget(target);
    withWorldTerrainFallback(live,retained,()=>renderer.render(scene,camera));
    const direct=read(target);
    renderer.setRenderTarget(null);
    composer=new EffectComposer(renderer,{frameBufferType:HalfFloatType,stencilBuffer:true,multisampling:0});
    composer.autoRenderToScreen=false;composer.addPass(new RenderPass(scene,camera));
    withWorldTerrainFallback(live,retained,()=>composer!.render());
    const atmosphereBuffer=read(composer.inputBuffer,true);
    // Next frame: a complete live surface must replace retained pixels immediately.
    fine.scale.x=2;fine.position.x=0;scene.updateMatrixWorld(true);
    withWorldTerrainFallback(live,retained,()=>composer!.render());
    const replacement=read(composer.inputBuffer,true);
    // Next frame: live geometry disappears; stencil from the previous frame must clear.
    fine.visible=false;
    withWorldTerrainFallback(live,retained,()=>composer!.render());
    const recovered=read(composer.inputBuffer,true);
    return {synthetic:true,direct,atmosphereBuffer,replacement,recovered,
      restored:green.stencilWrite===false&&red.stencilWrite===false&&nested.renderOrder===0};
  } finally {
    composer?.dispose();target.dispose();for(const m of [fine,old,route])m.geometry.dispose();
    green.dispose();red.dispose();blue.dispose();renderer.dispose();renderer.domElement.remove();
  }
}
