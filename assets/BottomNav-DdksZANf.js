import{c as t,a6 as n,j as e,a7 as l,m as o,a as r}from"./index-BX1-5uJX.js";/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=t("House",[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"1d0kgt"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=t("Search",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["path",{d:"m21 21-4.3-4.3",key:"1qie3q"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=t("User",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=t("Users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]]),p=[{to:"/",icon:i,label:"Feed"},{to:"/following",icon:m,label:"Following"},{to:"/search",icon:d,label:"Search"},{to:"/profile",icon:x,label:"Profile"}];function h(){const c=n();return e.jsx("nav",{className:"fixed bottom-0 left-0 right-0 z-50 glass-strong safe-bottom",children:e.jsx("div",{className:"flex items-center justify-around py-2 px-4 max-w-lg mx-auto",children:p.map(a=>{const s=c.pathname===a.to;return e.jsxs(l,{to:a.to,className:"flex flex-col items-center gap-1 p-2 relative",children:[e.jsxs(o.div,{whileTap:{scale:.9},className:r("p-2 rounded-xl transition-colors",s?"text-primary":"text-muted-foreground hover:text-foreground"),children:[e.jsx(a.icon,{className:"w-6 h-6"}),s&&e.jsx(o.div,{layoutId:"nav-indicator",className:"absolute inset-0 bg-primary/10 rounded-xl",transition:{type:"spring",bounce:.2,duration:.6}})]}),e.jsx("span",{className:r("text-xs font-medium transition-colors",s?"text-primary":"text-muted-foreground"),children:a.label})]},a.to)})})})}export{h as B,d as S,m as U,x as a};
