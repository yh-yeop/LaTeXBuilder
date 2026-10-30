// 챕터 2 분석 화면(analysis.html, 2-5단계)의 계산: 보정, 닫힌 식, 해석해, 시나리오 실행.
// 모델 자체(장 3구획 + 모델 1 몸)는 stages.js의 Ch2.gutModel을 쓴다. F는 입력이 아니라 결과값이다.
// 브라우저와 Node(검증 스크립트) 양쪽에서 쓴다. engine.gen.js(globalThis.PBPK)와 stages.js가 먼저 로드되어 있어야 한다.
(function(G){
'use strict';
const E=G.PBPK;
if(!E) throw new Error('engine.gen.js를 먼저 불러와야 합니다');

const MW=291.3;                       // GS-441524 분자량
const CMAX_TARGET_UM=35;              // Cook 2022 경구 25 mg/kg 1회, 관측 Cmax 35 µM
const CMAX_TARGET=CMAX_TARGET_UM*MW/1000;  // = 10.1955 mg/L
const CAL={Dose_mgkg:25,N_d:1,tEnd:24};    // 보정 조건: Cook 2022 단일 투여
const MULT_MIN=0.25, MULT_MAX=4;

// 근거 표시. 고양이 직접 자료는 어느 항목에도 없다.
const EVIDENCE={
  k_in:{tag:'가정',text:'가정 시나리오 (ENT/CNT 변화)'},
  k_out:{tag:'문헌',text:'P-gp: 문헌 확인(마우스·사람, 대장) · BCRP: 가정 시나리오',parts:[['문헌','P-gp 변화: 문헌 확인(마우스·사람, 대장)'],['가정','BCRP 변화: 가정 시나리오']]},
  k_tr:{tag:'가정',text:'가정 시나리오 (통과 속도, 설사 시 증가)'},
  k_b:{tag:'가정',text:'기준 분배 프리셋에서 정한 값. 시나리오에서는 바꾸지 않음'}
};
const NO_CAT_DATA='고양이 직접 자료는 없습니다. 결과는 모델로 본 경향이며 실측 예측이 아닙니다.';

// 기준 분배 프리셋: po = k_out/(k_b+k_out). (k_b+k_out)/k_in = 1로 둔다 (가정).
const PARTITIONS=[
  {id:'in',label:'입구 우세',po:0.1,desc:'F 손실 대부분이 장 세포로 들어가지 못하고 통과(대변)로 빠지는 몫'},
  {id:'bal',label:'균형',po:0.5,desc:'입구 손실과 출구(내강으로 되돌림) 몫이 비슷함'},
  {id:'out',label:'출구 우세',po:0.8,desc:'장 세포에 들어간 뒤 P-gp/BCRP로 내강에 되돌려지는 몫이 큼'}
];
const F_BASE_DEFAULT=0.6;   // 가정: 모델 1 몸(FIP 청소율)에서는 Cook AUC를 F ≤ 1로 맞출 수 없어 기준 F는 정하지 못한다

const SCEN=s=>[
  {id:'base',label:'기준',m:{}},
  {id:'in_up',label:'입구↑',m:{m_in:s}},
  {id:'out_up',label:'출구↑',m:{m_out:s}},
  {id:'out_dn',label:'출구↓',m:{m_out:1/s}},
  {id:'tr_up',label:'통과↑ (설사)',m:{m_tr:s}}
];

/* ---------- 닫힌 식 ---------- */
// p1 = k_in/(k_in+k_tr), pb = k_b/(k_b+k_out), po = k_out/(k_b+k_out), F = p1·pb/(1 − p1·po)
function Fclosed(k){
  const p1=k.k_in/(k.k_in+k.k_tr), pb=k.k_b/(k.k_b+k.k_out), po=k.k_out/(k.k_b+k.k_out);
  return p1*pb/(1-p1*po);
}
// 기준 F와 po로 정한 단위 속도(공통 배수 λ = 1). F는 속도 비율로만 정해지므로 λ와 무관하다.
function unitRates(Fb,po){
  if(!(Fb>0&&Fb<1)) throw new Error('기준 F는 0과 1 사이여야 합니다');
  const pb=1-po, p1=Fb/(pb+Fb*po);
  return {k_in:1,k_tr:(1-p1)/p1,k_out:po,k_b:pb};
}
const scaleRates=(u,lam)=>({k_in:u.k_in*lam,k_out:u.k_out*lam,k_b:u.k_b*lam,k_tr:u.k_tr*lam});
function applyMult(k0,m){
  m=m||{};
  return {k_in:k0.k_in*(m.m_in??1),k_out:k0.k_out*(m.m_out??1),k_b:k0.k_b,k_tr:k0.k_tr*(m.m_tr??1)};
}
// F 비율이 1이 되는 경계: m_in = m_tr·(pb + po·m_out)
const boundaryMin=(k0,m_out,m_tr)=>{ const s=k0.k_b+k0.k_out; return (m_tr??1)*(k0.k_b/s+k0.k_out/s*m_out); };

/* ---------- 장 부분 해석해 (혈액과 독립인 2×2 선형계) ---------- */
// L' = −(k_in+k_tr)L + k_out E,  E' = k_in L − (k_out+k_b)E,  L(0)=D, E(0)=0
function gutAnalytic(k,D){
  const a=k.k_in+k.k_tr, c=k.k_out+k.k_b;
  const tr=-(a+c), det=a*c-k.k_in*k.k_out;
  const disc=Math.sqrt(Math.max(0,tr*tr/4-det));
  const l1=tr/2+disc, l2=tr/2-disc;     // 둘 다 음수
  // L = A1 e^{l1 t} + A2 e^{l2 t},  E = B (e^{l1 t} − e^{l2 t})
  const A1=D*(l2+a)/(l2-l1), A2=D-A1;
  const B=D*k.k_in/(l1-l2);
  const I=(l,t)=>Math.abs(l*t)<1e-8?t:(Math.exp(l*t)-1)/l;   // ∫0^t e^{lu} du
  return {
    lambdas:[l1,l2],
    L:t=>A1*Math.exp(l1*t)+A2*Math.exp(l2*t),
    E:t=>B*(Math.exp(l1*t)-Math.exp(l2*t)),
    fec:t=>k.k_tr*(A1*I(l1,t)+A2*I(l2,t)),
    abs:t=>k.k_b*B*(I(l1,t)-I(l2,t))
  };
}
// 극한 조건 k_out = k_tr = 0 (연쇄 흡수)
function gutChainAnalytic(k_in,k_b,D){
  return {
    L:t=>D*Math.exp(-k_in*t),
    E:t=>Math.abs(k_b-k_in)<1e-12?D*k_in*t*Math.exp(-k_in*t):D*k_in/(k_b-k_in)*(Math.exp(-k_in*t)-Math.exp(-k_b*t))
  };
}

/* ---------- 모델 만들기: 장 3구획 + 모델 1 몸 (stages.js의 Ch2.gutModel, 챕터 2 편집기 2-5단계와 같은 정의) ---------- */
if(!G.Ch2) throw new Error('stages.js를 먼저 불러와야 합니다');
const C2=G.Ch2({PV:E.PV,FV:E.FV,T_:E.T_,ORG:E.ORG,normalize:E.normalize,presets:{m1:E.presets.m1}});
const BODY_SUM=C2.BODY_SUM, buildModel=C2.gutModel;

/* ---------- 실행 ---------- */
function paramsOf(m){ const P={}; m.vars.forEach(v=>{ if(v.kind==='param') P[v.name]=E.num(v.value); }); return P; }
function compileModel(m){ E.setM(m); const C=E.compile(); if(C.errors.length) throw new Error(C.errors.join('; ')); return C; }
// over: 상수 덮어쓰기, opt: {tEnd, rtol}
function simulate(m,C,over,opt){
  opt=opt||{};
  const P=Object.assign(paramsOf(m),over||{});
  const t0=m.sim.t0, t1=opt.tEnd??m.sim.tEnd, rtol=opt.rtol??m.sim.rtol;
  const y0=m.eqs.map(q=>E.num(q.ic));
  const ev=E.makeEvents(C,P,m.eqs.length,t0,t1).ev;
  const r=E.integrateEvents(C,P,y0,t0,t1,rtol,ev,opt.method??m.sim.method);   // 적분기 선택은 챕터 1 run()과 같게 (기본 'auto')
  return {T:r.T,Y:r.Y,P,warn:r.warn,stiff:!!r.stiff,idx:Object.fromEntries(m.eqs.map((q,i)=>[q.state,i]))};
}
// 마지막 투약 간격 [(N−1)τ, Nτ]의 Cmax, Cmin(Nτ 직전 값), AUCτ. 농도는 C_b (mg/L)
function metrics(r){
  const P=r.P, tau=P.tau, N=Math.round(P.N_d), a=(N-1)*tau, b=Math.min(N*tau,r.T[r.T.length-1]);
  const i=r.idx.C_b, V=r.Y.map(y=>y[i]);
  const w=E.windowStats(r.T,V,a,b,[]);
  return {Cmax:w.mx,Cmin:E.interp1(r.T,V,b-1e-9),AUC:w.auc,win:[a,b]};
}
function cmaxOf(r){ const i=r.idx.C_b; let mx=-Infinity,tm=0; r.T.forEach((t,k)=>{ const y=r.Y[k][i]; if(y>mx){ mx=y; tm=t; } }); return {Cmax:mx,Tmax:tm}; }

/* ---------- 기준값 보정: 공통 배수 λ를 Cmax 목표에 맞춘다 ---------- */
// F는 비율로만 정해지므로 λ를 바꿔도 F는 그대로다. Cmax는 λ에 대해 단조 증가한다.
function calibrate(Fb,po,opt){
  opt=opt||{};
  const target=opt.target??CMAX_TARGET, u=unitRates(Fb,po);
  const m=buildModel(u), C=compileModel(m);
  const cm=lam=>{
    const k=scaleRates(u,lam);
    const r=simulate(m,C,{k_in0:k.k_in,k_out0:k.k_out,k_b0:k.k_b,k_tr0:k.k_tr,Dose_mgkg:CAL.Dose_mgkg,N_d:CAL.N_d},{tEnd:CAL.tEnd,rtol:opt.rtol??1e-8});
    return cmaxOf(r);
  };
  // 로그 λ에서 구간을 잡고 Illinois(수정 가위치법)로 푼다
  let x0=Math.log(0.1),x1=Math.log(10),f0=Math.log(cm(Math.exp(x0)).Cmax/target),f1=Math.log(cm(Math.exp(x1)).Cmax/target),n=0;
  while(f0>0&&n++<30){ x0-=2; f0=Math.log(cm(Math.exp(x0)).Cmax/target); }
  while(f1<0&&n++<30){ x1+=2; f1=Math.log(cm(Math.exp(x1)).Cmax/target); }
  if(f0>0||f1<0) throw new Error('Cmax 목표를 맞추는 λ를 찾지 못했습니다');
  let side=0,x=x0,it=0;
  for(;it<60;it++){
    x=(x0*f1-x1*f0)/(f1-f0);
    const fx=Math.log(cm(Math.exp(x)).Cmax/target);
    if(Math.abs(fx)<1e-9) break;
    if(fx*f1>0){ x1=x; f1=fx; if(side===-1) f0/=2; side=-1; }
    else{ x0=x; f0=fx; if(side===1) f1/=2; side=1; }
  }
  const lam=Math.exp(x), k0=scaleRates(u,lam), fin=cm(lam);
  return {Fb,po,lam,k0,Cmax:fin.Cmax,Tmax:fin.Tmax,target,iters:it,F:Fclosed(k0)};
}

G.Gut={E,MW,CMAX_TARGET,CMAX_TARGET_UM,CAL,MULT_MIN,MULT_MAX,EVIDENCE,NO_CAT_DATA,PARTITIONS,F_BASE_DEFAULT,SCEN,BODY_SUM,
  Fclosed,unitRates,scaleRates,applyMult,boundaryMin,gutAnalytic,gutChainAnalytic,buildModel,paramsOf,compileModel,simulate,metrics,cmaxOf,calibrate};
})(globalThis);
