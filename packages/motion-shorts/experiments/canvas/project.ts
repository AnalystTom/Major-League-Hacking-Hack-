import {makeProject,ObjectMetaField,SceneProps} from '@motion-canvas/core';
import scene from './scene?scene';

class CaptureExporter{
  static id='resurface/capture';static displayName='Benchmark frames';
  static meta(){return new ObjectMetaField('Capture',{});}
  static async create(){return new CaptureExporter();}
  async handleFrame(canvas:HTMLCanvasElement,frame:number){await (window as unknown as {saveFrame:(frame:number,data:string)=>Promise<void>}).saveFrame(frame,canvas.toDataURL('image/png').split(',')[1]);}
}

export default makeProject({scenes:[scene],plugins:[{name:'resurface-benchmark',exporters:()=>[CaptureExporter]}]});