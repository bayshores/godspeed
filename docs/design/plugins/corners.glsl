precision mediump float;
/** @resolution */ uniform vec2 u_resolution;
/** @label Content */ uniform sampler2D u_content;
/** @label Step @default 4 @range 1, 16 */ uniform float u_step;
void main(){
  vec2 p=gl_FragCoord.xy;
  vec2 d=min(p,u_resolution-p);
  vec2 i=floor(d/u_step);
  if(d.x>=0.0&&d.y>=0.0&&i.x+i.y<2.0){gl_FragColor=vec4(0.0);return;}
  gl_FragColor=texture2D(u_content,p/u_resolution);
}
