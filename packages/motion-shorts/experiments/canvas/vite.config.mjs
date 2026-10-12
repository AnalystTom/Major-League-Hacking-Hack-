import motionCanvas from '@motion-canvas/vite-plugin';
export default {plugins:[motionCanvas.default({project:'./project.ts'})],server:{host:'127.0.0.1'},esbuild:{jsx:'automatic',jsxImportSource:'@motion-canvas/2d/lib',tsconfigRaw:{compilerOptions:{experimentalDecorators:true}}}};
