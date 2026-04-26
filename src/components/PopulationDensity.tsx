import { useState } from "react";

interface Zone {
  id: string;
  name: string;
  nameEn: string;
  region: string;
  population: number;
  area: number;
  density: number;
  orefZone: string;
  sectors: {
    airports: number;
    hospitals: number;
    schools: number;
    universities: number;
    busLines: number;
    trainStations: number;
  };
  risk: "critical" | "high" | "medium" | "low";
  lat: number;
  lon: number;
}

const ZONES: Zone[] = [
  { id:"gush-dan", name:"גוש דן", nameEn:"Gush Dan", region:"מרכז", population:3_900_000, area:1_516, density:2572, orefZone:"גוש דן", sectors:{ airports:1, hospitals:18, schools:820, universities:12, busLines:180, trainStations:24 }, risk:"high", lat:32.085, lon:34.78 },
  { id:"jerusalem", name:"ירושלים", nameEn:"Jerusalem", region:"מרכז-ירושלים", population:1_100_000, area:652, density:1687, orefZone:"ירושלים", sectors:{ airports:0, hospitals:9, schools:540, universities:8, busLines:90, trainStations:4 }, risk:"medium", lat:31.77, lon:35.21 },
  { id:"haifa", name:"חיפה", nameEn:"Haifa", region:"צפון", population:950_000, area:866, density:1097, orefZone:"חיפה", sectors:{ airports:1, hospitals:6, schools:360, universities:5, busLines:70, trainStations:12 }, risk:"medium", lat:32.79, lon:34.99 },
  { id:"beer-sheva", name:"באר שבע", nameEn:"Beer Sheva", region:"דרום", population:680_000, area:14_185, density:48, orefZone:"נגב", sectors:{ airports:0, hospitals:4, schools:210, universities:3, busLines:40, trainStations:5 }, risk:"medium", lat:31.26, lon:34.81 },
  { id:"north", name:"גליל עליון", nameEn:"Upper Galilee", region:"צפון", population:340_000, area:3_200, density:106, orefZone:"גליל עליון", sectors:{ airports:0, hospitals:3, schools:180, universities:1, busLines:25, trainStations:3 }, risk:"high", lat:33.0, lon:35.5 },
  { id:"otef", name:"עוטף עזה", nameEn:"Gaza Envelope", region:"דרום", population:85_000, area:812, density:105, orefZone:"עוטף עזה", sectors:{ airports:0, hospitals:1, schools:42, universities:0, busLines:12, trainStations:2 }, risk:"critical", lat:31.38, lon:34.53 },
  { id:"sharon", name:"השרון", nameEn:"Sharon", region:"מרכז", population:760_000, area:1_340, density:567, orefZone:"שרון", sectors:{ airports:0, hospitals:5, schools:280, universities:2, busLines:55, trainStations:8 }, risk:"medium", lat:32.33, lon:34.86 },
  { id:"shfela", name:"שפלה", nameEn:"Shephelah", region:"מרכז-דרום", population:580_000, area:2_100, density:276, orefZone:"שפלה", sectors:{ airports:0, hospitals:4, schools:220, universities:2, busLines:45, trainStations:6 }, risk:"medium", lat:31.9, lon:34.9 },
  { id:"lachish", name:"לכיש", nameEn:"Lachish", region:"דרום", population:430_000, area:3_400, density:126, orefZone:"לכיש", sectors:{ airports:0, hospitals:2, schools:160, universities:1, busLines:28, trainStations:3 }, risk:"high", lat:31.55, lon:34.73 },
];

const SECTOR_LABELS: Record<string,{icon:string;label:string;color:string}> = {
  airports:      { icon:"✈️", label:"שדות תעופה", color:"#00e5ff" },
  hospitals:     { icon:"🏥", label:"בתי חולים",  color:"#ff4488" },
  schools:       { icon:"🎓", label:"בתי ספר",    color:"#ffd600" },
  universities:  { icon:"🏛️", label:"אוניברסיטאות", color:"#b040ff" },
  busLines:      { icon:"🚌", label:"קווי אוטובוס", color:"#00ff88" },
  trainStations: { icon:"🚆", label:"תחנות רכבת", color:"#ff8800" },
};

const RISK_META = {
  critical:{ label:"קריטי",  color:"#ff2244", barColor:"#ff2244", bg:"rgba(255,34,68,.08)" },
  high:    { label:"גבוה",   color:"#ff8800", barColor:"#ff8800", bg:"rgba(255,136,0,.06)" },
  medium:  { label:"בינוני", color:"#ffd600", barColor:"#ffd600", bg:"rgba(255,214,0,.05)" },
  low:     { label:"נמוך",   color:"#00ff88", barColor:"#00ff88", bg:"rgba(0,255,136,.04)" },
};

function DensityBar({ value, max, color }: { value:number; max:number; color:string }) {
  return (
    <div style={{ height:"4px", background:"#112233", borderRadius:"2px", overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${Math.min(100,(value/max)*100)}%`, background:color, borderRadius:"2px", transition:"width .6s ease" }}/>
    </div>
  );
}

export default function PopulationDensity() {
  const [selectedSector, setSelectedSector] = useState<string>("all");
  const [selectedZone, setSelectedZone] = useState<Zone|null>(null);
  const [sortBy, setSortBy] = useState<"density"|"population"|"risk">("density");

  const sorted = [...ZONES].sort((a,b) => {
    if (sortBy === "density")    return b.density - a.density;
    if (sortBy === "population") return b.population - a.population;
    const riskOrder = {critical:0,high:1,medium:2,low:3};
    return riskOrder[a.risk] - riskOrder[b.risk];
  });

  const maxDensity = Math.max(...ZONES.map(z => z.density));
  const maxPop     = Math.max(...ZONES.map(z => z.population));
  const totalPop   = ZONES.reduce((s,z) => s + z.population, 0);

  return (
    <div style={{ background:"#03080d", color:"#b8d4e8", fontFamily:"'Orbitron', 'Share Tech Mono', monospace", minHeight:"100vh", direction:"rtl" }}>
      <div style={{ background:"rgba(6,14,22,.97)", borderBottom:"1px solid #112233", padding:"14px 20px", display:"flex", alignItems:"center", gap:"12px" }}>
        <span style={{fontSize:"20px"}}>🗺️</span>
        <span style={{fontSize:"12px", letterSpacing:"3px", color:"#ffd600", fontWeight:700}}>POPULATION DENSITY</span>
        <span style={{fontSize:"9px", color:"#2a4458", marginRight:"auto"}}>צפיפות אוכלוסין לפי סקטורים</span>
      </div>

      <div style={{padding:"16px", maxWidth:"1200px", margin:"0 auto"}}>
        <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px", marginBottom:"16px"}}>
          {[
            {n:totalPop.toLocaleString(),        l:"אוכלוסין סה\"כ",  c:"#b8d4e8"},
            {n:ZONES.length,                     l:"אזורים",          c:"#00e5ff"},
            {n:ZONES.filter(z=>z.risk==="critical").length, l:"קריטיים", c:"#ff2244"},
            {n:ZONES.reduce((s,z)=>s+z.sectors.schools,0).toLocaleString(), l:"בתי ספר", c:"#ffd600"},
          ].map(s => (
            <div key={s.l} style={{ background:"rgba(6,14,22,.85)", border:"1px solid #112233", borderRadius:"10px", padding:"12px", textAlign:"center" }}>
              <div style={{fontSize:"20px", fontWeight:700, color:s.c}}>{s.n}</div>
              <div style={{fontSize:"8px", color:"#2a4458", letterSpacing:"1px", marginTop:"4px"}}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex", gap:"6px", marginBottom:"14px", flexWrap:"wrap"}}>
          <button onClick={()=>setSelectedSector("all")} style={{
            padding:"5px 14px", borderRadius:"16px", border:"1px solid #112233",
            background:selectedSector==="all"?"rgba(0,229,255,.12)":"transparent",
            color:selectedSector==="all"?"#00e5ff":"#2a4458",
            fontSize:"9px", cursor:"pointer", fontFamily:"inherit", letterSpacing:"1px",
          }}>📊 הכל</button>
          {Object.entries(SECTOR_LABELS).map(([k,v]) => (
            <button key={k} onClick={()=>setSelectedSector(k)} style={{
              padding:"5px 12px", borderRadius:"16px", border:"1px solid #112233",
              background:selectedSector===k?`${v.color}18`:"transparent",
              color:selectedSector===k?v.color:"#2a4458",
              fontSize:"9px", cursor:"pointer", fontFamily:"inherit", letterSpacing:"1px",
            }}>{v.icon} {v.label}</button>
          ))}
        </div>

        <div style={{display:"flex", gap:"6px", marginBottom:"14px"}}>
          <span style={{fontSize:"9px", color:"#2a4458", alignSelf:"center", letterSpacing:"1px"}}>מיין לפי:</span>
          {(["density","population","risk"] as const).map(s => (
            <button key={s} onClick={()=>setSortBy(s)} style={{
              padding:"4px 12px", borderRadius:"10px", border:"none",
              background:sortBy===s?"rgba(0,229,255,.1)":"transparent",
              color:sortBy===s?"#00e5ff":"#2a4458",
              fontSize:"9px", cursor:"pointer", fontFamily:"inherit",
            }}>
              {s==="density"?"צפיפות":s==="population"?"אוכלוסין":"סיכון"}
            </button>
          ))}
        </div>

        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"12px"}}>
          {sorted.map(zone => {
            const rm = RISK_META[zone.risk];
            const isSelected = selectedZone?.id === zone.id;
            return (
              <div key={zone.id} onClick={()=>setSelectedZone(isSelected?null:zone)}
                style={{
                  background: isSelected ? rm.bg : "rgba(6,14,22,.85)",
                  border:`1px solid ${isSelected ? rm.color : "#112233"}`,
                  borderRadius:"12px", padding:"14px", cursor:"pointer",
                  transition:"all .2s",
                }}>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"10px"}}>
                  <div>
                    <div style={{fontSize:"14px", color:"#fff", fontWeight:700}}>{zone.name}</div>
                    <div style={{fontSize:"9px", color:"#2a4458", marginTop:"2px"}}>{zone.region} · OREF: {zone.orefZone}</div>
                  </div>
                  <span style={{
                    padding:"3px 10px", borderRadius:"10px",
                    background:rm.bg, color:rm.color,
                    fontSize:"9px", letterSpacing:"1px", border:`1px solid ${rm.color}44`,
                  }}>{rm.label}</span>
                </div>

                <div style={{marginBottom:"10px"}}>
                  <div style={{display:"flex", justifyContent:"space-between", marginBottom:"4px"}}>
                    <span style={{fontSize:"9px", color:"#2a4458"}}>אוכלוסין</span>
                    <span style={{fontSize:"10px", color:"#b8d4e8", fontFamily:"monospace"}}>
                      {(zone.population/1000).toFixed(0)}K
                    </span>
                  </div>
                  <DensityBar value={zone.population} max={maxPop} color="#00e5ff"/>
                  <div style={{display:"flex", justifyContent:"space-between", marginTop:"6px"}}>
                    <span style={{fontSize:"9px", color:"#2a4458"}}>צפיפות</span>
                    <span style={{fontSize:"10px", color:rm.color, fontFamily:"monospace"}}>
                      {zone.density.toLocaleString()} לkm²
                    </span>
                  </div>
                  <DensityBar value={zone.density} max={maxDensity} color={rm.barColor}/>
                </div>

                <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"6px"}}>
                  {Object.entries(zone.sectors)
                    .filter(([k]) => selectedSector === "all" || k === selectedSector)
                    .map(([k,v]) => {
                    const sl = SECTOR_LABELS[k];
                    return (
                      <div key={k} style={{
                        background:"rgba(0,0,0,.3)", borderRadius:"6px",
                        padding:"6px 4px", textAlign:"center",
                        border: selectedSector === k ? `1px solid ${sl.color}44` : "1px solid transparent",
                      }}>
                        <div style={{fontSize:"14px"}}>{sl.icon}</div>
                        <div style={{fontSize:"11px", color:sl.color, fontWeight:700}}>{v}</div>
                        <div style={{fontSize:"7px", color:"#2a4458", marginTop:"1px"}}>{sl.label}</div>
                      </div>
                    );
                  })}
                </div>

                {isSelected && (
                  <div style={{marginTop:"12px", paddingTop:"12px", borderTop:"1px solid #112233"}}>
                    <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px", fontSize:"10px"}}>
                      <div><span style={{color:"#2a4458"}}>שטח: </span><span style={{color:"#fff"}}>{zone.area.toLocaleString()} km²</span></div>
                      <div><span style={{color:"#2a4458"}}>צפיפות: </span><span style={{color:rm.color}}>{zone.density.toLocaleString()}/km²</span></div>
                      <div><span style={{color:"#2a4458"}}>קוורד: </span><span style={{color:"#00e5ff", fontFamily:"monospace"}}>{zone.lat.toFixed(3)}N {zone.lon.toFixed(3)}E</span></div>
                      <div><span style={{color:"#2a4458"}}>אזור OREF: </span><span style={{color:"#fff"}}>{zone.orefZone}</span></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Share+Tech+Mono&display=swap');
      `}</style>
    </div>
  );
}
