precision mediump float;
/** @resolution */ uniform vec2 u_resolution;
/** @label Dot @color @default #5d5d5d */ uniform vec3 u_color;
/** @label Spacing @default 4 @range 2, 16 */ uniform float u_gap;
void main(){
  float on=step(mod(gl_FragCoord.x,u_gap),u_gap*0.5);
  gl_FragColor=vec4(u_color*on,on);
}
