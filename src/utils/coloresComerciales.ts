/** Equivalencias explícitas. Los códigos desconocidos se conservan para revisión. */
const colores: Record<string,string> = {
 WHITE:'Blanco',FTWWHT:'Blanco','FTWR WHITE':'Blanco','CLASSIC WHITE':'Blanco',
 BLACK:'Negro',CBLACK:'Negro','CORE BLACK':'Negro','NIGHT BLACK':'Negro',
 GREY:'Gris',GRAY:'Gris',PUGRY3:'Gris','PURE GREY':'Gris','LGH SOLID GREY':'Gris',
 PINK:'Rosa',PROPNK:'Rosa',LILGLW:'Lila',LILAC:'Lila',LILA:'Lila',PURPLE:'Violeta',
 BLUE:'Azul',NAVY:'Azul Marino',VECNAV:'Azul Marino','VECTOR NAVY':'Azul Marino','BLUE MARINE':'Azul Marino',
 GREEN:'Verde',RED:'Rojo',VECRED:'Rojo',YELLOW:'Amarillo',ORANGE:'Naranja',BEIGE:'Beige',BROWN:'Marrón',CHALK:'Tiza',
 'VECTOR BLUE':'Azul','VECTOR RED':'Rojo','DARK GREEN':'Verde',
 'GLEN GREEN':'Verde','FIELD GREEN':'Verde','VINTAGE CHALK':'Tiza','LIGHT GREY MARL':'Gris','BARLEY GREY':'Gris','SILVER MARL':'Gris','PLAYFUL PINK':'Rosa','ICE BLUE':'Azul','DENIM BLUE':'Azul','WARPED BLUE':'Azul','GREEN OPALE':'Verde','GREEN PARSLEY':'Verde','PINK PASTEL':'Rosa','YELLOW LT':'Amarillo',FUCHSIA:'Fucsia',
};
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const keys=Object.keys(colores).sort((a,b)=>b.length-a.length);
const inicio=new RegExp(`\\s+(${keys.map(escape).join('|')})(?=[\\s/\\-]|$)`,'i');
function traducir(v:string) {
 const key=v.trim().toUpperCase().replace(/\s+/g,' ').replace(/\s+\d+$/,'');
 return colores[key];
}
export function simplificarColores(nombre:string): { titulo:string; pendientes:string[] } {
 const limpio=nombre.replace(/\s+/g,' ').trim();
 // Separador del proveedor o inicio explícito de un color conocido.
 const separador=limpio.lastIndexOf(' - ');
 const match=limpio.match(inicio);
 const index=separador>=0?separador:match?.index;
 if(index===undefined) return {titulo:limpio,pendientes:limpio.includes('/')?[limpio.split(' ').at(-1)!]:[]};
 const base=limpio.slice(0,index).trim();
 const bloque=limpio.slice(index+(separador>=0?3:1));
 const partes=bloque.split(/[\/\-]/).map(s=>s.trim()).filter(Boolean);
 const pendientes=partes.filter(s=>!traducir(s));
 // Sin separador explícito, no confundir un nombre de modelo con un color.
 if(separador<0 && partes.length===1 && pendientes.length) return {titulo:limpio,pendientes:[bloque]};
 const traducidos=[...new Set(partes.map(s=>traducir(s)||s))];
 return {titulo:`${base} ${traducidos.join(' ')}`.replace(/\s+/g,' ').trim(),pendientes};
}
