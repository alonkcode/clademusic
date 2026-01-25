import{c as s,a7 as n,j as a,a8 as c,b as o}from"./index-C_XsIiZR.js";import{m as r}from"./proxy-BTYDhvTv.js";import{M as l,S as d}from"./search-BqHCb8l6.js";/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=s("House",[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"1d0kgt"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=s("ListMusic",[["path",{d:"M21 15V6",key:"h1cx4g"}],["path",{d:"M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",key:"8saifv"}],["path",{d:"M12 12H3",key:"18klou"}],["path",{d:"M16 6H3",key:"1wxfjs"}],["path",{d:"M12 18H3",key:"11ftsu"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=s("User",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]),x=[{to:"/",icon:m,label:"Feed"},{to:"/forum",icon:l,label:"Forums"},{to:"/search",icon:d,label:"Search"},{to:"/playlists",icon:u,label:"Lists"},{to:"/profile",icon:p,label:"Profile"}];function v(){const i=n();return a.jsx("nav",{className:"fixed bottom-0 left-0 right-0 z-50 glass-strong safe-bottom",children:a.jsx("div",{className:"flex items-center justify-around py-2 px-4 max-w-lg mx-auto",children:x.map(e=>{const t=i.pathname===e.to;return a.jsxs(c,{to:e.to,className:"flex flex-col items-center gap-1 p-2 relative",children:[a.jsxs(r.div,{whileTap:{scale:.9},className:o("p-2 rounded-xl transition-colors",t?"text-primary":"text-muted-foreground hover:text-foreground"),children:[a.jsx(e.icon,{className:"w-6 h-6"}),t&&a.jsx(r.div,{layoutId:"nav-indicator",className:"absolute inset-0 bg-primary/10 rounded-xl",transition:{type:"spring",bounce:.2,duration:.6}})]}),a.jsx("span",{className:o("text-xs font-medium transition-colors",t?"text-primary":"text-muted-foreground"),children:e.label})]},e.to)})})})}export{v as B,u as L,p as U};
