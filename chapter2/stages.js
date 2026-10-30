// 챕터 2 · 장내 미생물 → PBPK 단계 묶음.
// - chapter2/index.html(챕터 1 편집기를 그대로 쓰는 페이지)이 STAGE_PACK으로 이 단계들을 불러온다.
// - 분석 화면(analysis.html)과 검증 스크립트도 Ch2(api)로 같은 모델을 만든다.
// api: 챕터 1의 모델 도우미 {PV, FV, T_, ORG, normalize, presets:{m1}} (index.html 또는 engine.gen.js가 넘김)
// 시간 단위는 모두 h. 미생물 양은 최대 수용량 대비 비율. 고양이 자료가 없어 미생물·교란·P-gp 값은 모두 가정이다.
(function(G){
'use strict';

// 기준 장 속도: Cook 2022 경구 25 mg/kg 1회 Cmax 35 µM에 맞춘 값 (기준 F 0.6 가정, 균형 프리셋 po 0.5).
// tests/chapter2.mjs가 model.js의 calibrate() 결과와 같은지 확인한다.
const K0={k_in:14.158911865639379,k_out:7.079455932819689,k_b:7.079455932819689,k_tr:4.719637288546463};
const NO_CAT='고양이 직접 자료는 없습니다. 결과는 모델로 본 경향이며 실측 예측이나 투약 판단에 쓰는 값이 아닙니다.';
// 평형점 (기본 경쟁 계수 a_co 0.3, a_oc 0.9): 교란 단계는 여기서 시작한다
const XC_EQ=0.7/0.73, XO_EQ=0.1/0.73;

function Ch2(api){
  const {PV,FV,T_}=api;
  const lg=(v)=>Object.assign(v,{log:true});

  /* ---- 장 3구획 + 모델 1 몸 (2-4, 2-5, 분석 화면) ---- */
  const BODY_SUM=()=>'V_b*C_b + '+api.ORG.map(o=>'V_'+o[0]+'*C_'+o[0]).join(' + ')+' + V_asc*C_asc + A_el';
  function gutModel(k0){
    const m=api.presets.m1();      // 챕터 1 3단계와 같은 몸 (값·식 동일)
    m.vars=m.vars.filter(v=>v.name!=='F'&&v.name!=='ka');
    const K=(name,latex,x)=>PV(name,latex,x,0,(x>0?x:1)*8,'1/h');   // 0도 그대로 둔다 (극한 조건 검증용)
    m.vars.push(
      K('k_in0','k_{in,0}',k0.k_in),K('k_out0','k_{out,0}',k0.k_out),K('k_b0','k_{b,0}',k0.k_b),K('k_tr0','k_{tr,0}',k0.k_tr),
      lg(PV('m_in','m_{in}',1,0.25,4,'배')),lg(PV('m_out','m_{out}',1,0.25,4,'배')),lg(PV('m_tr','m_{tr}',1,0.25,4,'배')),
      FV('k_in','k_{in}','k_in0*m_in','1/h'),FV('k_out','k_{out}','k_out0*m_out','1/h'),FV('k_b','k_b','k_b0','1/h'),FV('k_tr','k_{tr}','k_tr0*m_tr','1/h'));
    const gi=m.eqs.findIndex(q=>q.state==='A_gut');
    m.eqs.splice(gi,1,
      {state:'A_L',latex:'A_L',cap:'1',ic:0,unit:'mg',terms:[T_(-1,'k_in*A_L'),T_(1,'k_out*A_E'),T_(-1,'k_tr*A_L')]},
      {state:'A_E',latex:'A_E',cap:'1',ic:0,unit:'mg',terms:[T_(1,'k_in*A_L'),T_(-1,'k_out*A_E'),T_(-1,'k_b*A_E')]});
    const cb=m.eqs.find(q=>q.state==='C_b');
    const ti=cb.terms.findIndex(tm=>tm.expr==='ka*A_gut');
    if(ti<0) throw new Error('모델 1의 혈액 식에서 흡수 항(ka*A_gut)을 찾지 못했습니다');
    cb.terms[ti]=T_(1,'k_b*A_E');
    m.eqs.push(
      {state:'A_fec',latex:'A_{fec}',cap:'1',ic:0,unit:'mg',terms:[T_(1,'k_tr*A_L')]},
      {state:'A_abs',latex:'A_{abs}',cap:'1',ic:0,unit:'mg',terms:[T_(1,'k_b*A_E')]});
    m.doses=[{on:true,label:'경구 투여 (용량 전체가 내강으로, F를 곱하지 않음)',target:'A_L',amt:'Dmg',start:'0',tau:'tau',n:'N_d'}];
    m.cmps=[{on:true,strict:true,label:'질량 보존 (장 내강 + 장 세포 + 대변 + 몸 + 소실 vs 누적 투여)',sim:'A_L + A_E + A_fec + '+BODY_SUM(),kind:'ref',ref:'Dmg*n_d',data:''}];
    m.exps=[];
    m.info=null;
    m.opts.breakTerms=false;
    m.sim.rtol=1e-7;
    // 적분기는 명시적(Dormand–Prince)으로 고정. 'auto'는 이 모델에서 Rodas3로 바뀌어 약 2.7배 느리고 결과 차이는 1e-5 수준
    m.sim.method='explicit';
    return m;
  }

  /* ---- 로트카–볼테라 2군 경쟁 ---- */
  const lvVars=()=>[
    PV('r_c','r_c',0.05,0,0.3,'1/h'),PV('r_o','r_o',0.08,0,0.3,'1/h'),
    PV('a_co','a_{co}',0.3,0,1.5,'-'),PV('a_oc','a_{oc}',0.9,0,1.5,'-'),
    FV('xcs','x_c^{*}','(1 - a_co)/(1 - a_co*a_oc)','-'),FV('xos','x_o^{*}','(1 - a_oc)/(1 - a_co*a_oc)','-')];
  const lvEqs=(xc0,xo0,loss)=>[
    {state:'x_c',latex:'x_c',cap:'1',ic:xc0,unit:'-',terms:[T_(1,'r_c*x_c*(1 - x_c - a_co*x_o)'),...(loss?[T_(-1,'L_c*x_c')]:[])]},
    {state:'x_o',latex:'x_o',cap:'1',ic:xo0,unit:'-',terms:[T_(1,'r_o*x_o*(1 - x_o - a_oc*x_c)'),...(loss?[T_(-1,'L_o*x_o')]:[])]}];
  // 교란: 장염(기간 창, 공생균 손실), 항생제(기간 창, 두 군 손실), FIP(시점 이후 지속, 공생균 약한 손실)
  const pertVars=()=>[
    PV('en_on','on_{en}',1,0,1,'-'),PV('t_en','t_{en}',240,0,600,'h'),PV('T_en','T_{en}',72,0,240,'h'),PV('mu_en','\\mu_{en}',0.03,0,0.2,'1/h'),
    PV('ab_on','on_{ab}',0,0,1,'-'),PV('t_ab','t_{ab}',240,0,600,'h'),PV('T_ab','T_{ab}',120,0,336,'h'),PV('k_abc','\\kappa_{ab,c}',0.06,0,0.3,'1/h'),PV('k_abo','\\kappa_{ab,o}',0.02,0,0.3,'1/h'),
    PV('fip_on','on_{FIP}',0,0,1,'-'),PV('t_fip','t_{FIP}',120,0,600,'h'),PV('mu_fip','\\mu_{FIP}',0.005,0,0.05,'1/h'),
    FV('W_en','W_{en}','en_on*(step(t - t_en) - step(t - t_en - T_en))','-'),
    FV('W_ab','W_{ab}','ab_on*(step(t - t_ab) - step(t - t_ab - T_ab))','-'),
    FV('H_fip','H_{FIP}','fip_on*step(t - t_fip)','-'),
    FV('L_c','L_c','mu_en*W_en + k_abc*W_ab + mu_fip*H_fip','1/h'),
    FV('L_o','L_o','k_abo*W_ab','1/h')];
  // 대사산물 S_m(부티르산·2차 담즙산 대표, 기준 1)과 P-gp 발현 P_gp(간접 반응, 기준 1)
  const pgpVars=()=>[
    PV('k_S','k_S',0.2,0,2,'1/h'),PV('k_P','k_P',0.0144,0,0.1,'1/h'),PV('E_P','E_P',0.6,0,1,'-'),PV('EC_P','EC_{50,P}',0.5,0.05,5,'-'),
    FV('Stim','\\mathrm{Stim}','(1 - E_P) + E_P*S_m*(1 + EC_P)/(EC_P + S_m)','-')];
  const pgpEqs=()=>[
    {state:'S_m',latex:'S_m',cap:'1',ic:1,unit:'-',terms:[T_(1,'k_S*(x_c/xcs - S_m)')]},
    {state:'P_gp',latex:'P_{gp}',cap:'1',ic:1,unit:'-',terms:[T_(1,'k_P*(Stim - P_gp)')]}];
  const lvSim=(tEnd,rtol)=>({t0:0,tEnd,tunit:'h',rtol,method:'auto'});
  const opts={cdot:true,breakTerms:false,logY:false};

  function g1(){
    return api.normalize({
      vars:[...lvVars(),PV('x0','x_0',0.05,0.001,1,'-')],
      eqs:[...lvEqs(0.05,0.05,false),
        {state:'y_c',latex:'y_c',cap:'1',ic:0.05,unit:'-',terms:[T_(1,'r_c*y_c*(1 - y_c)')]}],
      doses:[],
      cmps:[{on:true,label:'로지스틱 해석해 (경쟁자 없는 공생균 y_c)',sim:'y_c',kind:'ref',ref:'1/(1 + (1/x0 - 1)*exp(-r_c*t))',data:''}],
      exps:[],sim:lvSim(1440,1e-9),   // 느린 모드 시간상수가 약 135 h라 60일까지 본다
      sweep:{on:false,name:'a_co',from:0.1,to:1.2,n:6,log:false,show:'x_c'},opts});
  }
  function g2(){
    return api.normalize({
      vars:[...lvVars(),...pertVars()],
      eqs:lvEqs(XC_EQ,XO_EQ,true),doses:[],cmps:[],
      exps:[{on:true,label:'공생균 x_c / 평형 (90% 이상 유지 시간)',expr:'x_c/xcs',scale:'1',t0:'0',t1:'720',thr:'0.9'},
        {on:true,label:'기회균 x_o / 평형 (최댓값)',expr:'x_o/xos',scale:'1',t0:'0',t1:'720',thr:''}],
      sim:lvSim(720,1e-8),
      sweep:{on:false,name:'mu_en',from:0.01,to:0.1,n:6,log:true,show:'x_c'},opts});
  }
  function g3(){
    const m=g2();
    m.vars.push(...pgpVars());
    m.eqs.push(...pgpEqs());
    m.exps=[{on:true,label:'P-gp 발현 P_gp (기준 90% 이상 유지 시간, 구간 끝 값)',expr:'P_gp',scale:'1',t0:'0',t1:'720',thr:'0.9'},
      {on:true,label:'대사산물 S_m (기준 90% 이상 유지 시간)',expr:'S_m',scale:'1',t0:'0',t1:'720',thr:'0.9'}];
    m.sweep=Object.assign(m.sweep,{name:'E_P',from:0.1,to:0.9,n:5,log:false,show:'P_gp'});
    return api.normalize(m);
  }
  function g4(){
    const m=gutModel(K0);
    m.vars.push(...lvVars(),...pertVars(),...pgpVars(),PV('m_dia','m_{dia}',2,1,5,'배'),
      FV('F_t','F(t)','k_in*k_b/(k_in*k_b + k_tr*(k_b + k_out))','-'));
    // P-gp 발현을 출구 속도에, 장염 중 설사를 통과 속도에 연결 (ENT/CNT 연결 근거는 없어 k_in은 그대로)
    m.vars.find(v=>v.name==='k_out').expr='k_out0*m_out*P_gp';
    m.vars.find(v=>v.name==='k_tr').expr='k_tr0*m_tr*(1 + (m_dia - 1)*W_en)';
    m.eqs.unshift(...lvEqs(XC_EQ,XO_EQ,true),...pgpEqs());
    const N=m.vars.find(v=>v.name==='N_d'); N.value=28; N.expr='28'; N.max=Math.max(N.max,56);
    m.exps=[
      {on:true,label:'교란 전 투약 간격 (C_b, mg/L)',expr:'C_b',scale:'1',t0:'t_en - tau',t1:'t_en',thr:''},
      {on:true,label:'장염 중 투약 간격',expr:'C_b',scale:'1',t0:'t_en + tau',t1:'t_en + 2*tau',thr:''},
      {on:true,label:'마지막 투약 간격 (회복 후)',expr:'C_b',scale:'1',t0:'(N_d - 1)*tau',t1:'N_d*tau',thr:''},
      {on:true,label:'F(t) 닫힌 식 · 장염 중 간격',expr:'F_t',scale:'1',t0:'t_en + tau',t1:'t_en + 2*tau',thr:''},
      {on:true,label:'F(t) 닫힌 식 · 장염 뒤 (설사는 끝, P-gp는 회복 중)',expr:'F_t',scale:'1',t0:'t_en + T_en',t1:'N_d*tau',thr:''}];
    m.sim=Object.assign(m.sim,{tEnd:672});
    m.sweep={on:false,name:'mu_en',from:0.01,to:0.1,n:4,log:true,show:'C_b'};
    m.opts.breakTerms=false;
    return api.normalize(m);
  }
  function g5(){ return api.normalize(gutModel(K0)); }

  const tag=(t,n)=>[t,n];
  const LV='고양이 장내 미생물 자료 없음. 개념을 보기 위한 가정값';
  const ann={
    r_c:tag('가정','공생균 순성장 속도. '+LV),r_o:tag('가정','기회균 순성장 속도. '+LV),
    a_co:tag('가정','기회균이 공생균에 주는 경쟁 효과. '+LV),a_oc:tag('가정','공생균의 기회균 억제(집락 저항성). '+LV),
    x0:tag('가정','초기 비율 (x_c, x_o, y_c의 초깃값과 같게 둘 것)'),
    en_on:tag('가정','장염 교란 켜기(1) / 끄기(0)'),t_en:tag('가정','장염 시작 시점'),T_en:tag('가정','장염 기간'),mu_en:tag('가정','장염 중 공생균 손실 속도'),
    ab_on:tag('가정','항생제 교란 켜기(1) / 끄기(0)'),t_ab:tag('가정','항생제 시작 시점'),T_ab:tag('가정','항생제 기간'),
    k_abc:tag('가정','항생제의 공생균 손실 속도. 감수성 차이는 가정'),k_abo:tag('가정','항생제의 기회균 손실 속도. 감수성 차이는 가정'),
    fip_on:tag('가정','FIP 교란 켜기(1) / 끄기(0)'),t_fip:tag('가정','FIP 교란 시작 시점'),mu_fip:tag('가정','FIP에 따른 공생균 지속 손실. 근거가 가장 약함'),
    k_S:tag('가정','대사산물 생성·소실 속도'),k_P:tag('가정','P-gp 발현 회복 속도 (반감기 약 48 h 가정)'),
    E_P:tag('가정','대사산물에 의존하는 P-gp 몫. 방향(미생물·대사산물이 P-gp 유도)은 문헌 확인(마우스·사람, 대장), 크기는 가정'),
    EC_P:tag('가정','P-gp 자극의 반포화 대사산물 수준'),m_dia:tag('가정','장염(설사) 중 통과 속도 배수'),
    k_in0:tag('보정','Cook 2022 Cmax 35 µM에 맞춘 값 (기준 F 0.6 가정, 균형 프리셋)'),k_out0:tag('보정','Cook 2022 Cmax 35 µM에 맞춘 값 (기준 F 0.6 가정, 균형 프리셋)'),
    k_b0:tag('보정','Cook 2022 Cmax 35 µM에 맞춘 값 (기준 F 0.6 가정, 균형 프리셋)'),k_tr0:tag('보정','Cook 2022 Cmax 35 µM에 맞춘 값 (기준 F 0.6 가정, 균형 프리셋)'),
    m_in:tag('가정','입구(ENT/CNT) 변화 배수. 가정 시나리오'),m_out:tag('문헌','출구 변화 배수. P-gp 변화: 문헌 확인(마우스·사람, 대장) · BCRP: 가정 시나리오'),
    m_tr:tag('가정','통과 속도 배수. 가정 시나리오'),F_t:tag('계산','순간 F 닫힌 식 k_in·k_b / (k_in·k_b + k_tr·(k_b + k_out))')
  };
  const info={
    g1:{title:'2-1 · 로트카–볼테라 2군 경쟁 (장내 미생물)',
      goal:'공생균 x_c와 기회균 x_o가 경쟁하며 자라는 모습을 봅니다. 양은 최대 수용량 대비 비율입니다. 경쟁자가 없는 공생균 y_c를 같이 두어 로지스틱 해석해로 계산을 검증합니다.',
      look:'요약 지표 아래 로지스틱 해석해 비교, x_c·x_o 최종값과 변수 카드의 평형점 x_c*·x_o*',
      pass:'해석해 비교 ✓. 60일 끝값이 평형점 x_c* = (1−a_co)/(1−a_co·a_oc), x_o* = (1−a_oc)/(1−a_co·a_oc)에 가까우면 정상입니다 (기본값 약 0.959, 0.137). 두 계수가 1보다 작으면 둘 다 살아남습니다.',
      warn:'성장 속도와 경쟁 계수는 모두 가정입니다. '+NO_CAT,next:'g2',show:['x_c','x_o','y_c']},
    g2:{title:'2-2 · 교란과 회복 (장염 · 항생제 · FIP)',
      goal:'평형에서 시작해 장염(기간 동안 공생균 손실), 항생제(두 군 모두 손실), FIP(이후 지속되는 약한 손실)를 켜고 끄며 공생균이 줄었다가 회복하는 과정을 봅니다. 회복 곡선은 로트카–볼테라가 만듭니다.',
      look:'그래프의 회복 속도, 노출 지표의 x_c 평형 90% 이상 유지 시간',
      pass:'교란을 모두 끄면(en_on = ab_on = fip_on = 0) 곡선이 평형에 그대로 머뭅니다. 정답이 있는 단계가 아니라 가정 시나리오입니다.',
      warn:'교란의 크기·기간·감수성은 모두 가정이고, FIP 교란은 근거가 가장 약합니다. '+NO_CAT,next:'g3',show:['x_c','x_o']},
    g3:{title:'2-3 · 대사산물 → P-gp 발현',
      goal:'공생균이 만드는 대사산물(부티르산·2차 담즙산을 대표하는 S_m)이 장 P-gp 발현을 유도한다고 보고, 간접 반응 모델로 P-gp 발현 P_gp(기준 1)를 계산합니다.',
      look:'S_m과 P_gp 곡선, 노출 지표의 P-gp 기준 90% 이상 유지 시간과 구간 끝 값',
      pass:'교란이 없으면 S_m = P_gp = 1로 유지됩니다. 자극 식은 S_m = 1에서 1이 되도록 맞췄습니다.',
      warn:'방향(미생물·대사산물이 P-gp를 유도하고 장염·항생제에서 줄어듦)은 문헌 확인(마우스·사람, 대장)이고, 크기(E_P, EC50)와 속도(k_S, k_P)는 가정입니다. '+NO_CAT,next:'g4',show:['x_c','S_m','P_gp']},
    g4:{title:'2-4 · PBPK 연결 (미생물 → 장 3구획 → 모델 1)',
      goal:'2-3의 P-gp 발현을 출구 속도 k_out에, 장염 중 설사를 통과 속도 k_tr에 연결하고, 장 3구획과 챕터 1 모델 1 몸을 붙여 28일 투약을 계산합니다. F는 입력이 아니라 결과값입니다.',
      look:'노출 지표의 교란 전·장염 중·마지막 간격 비교, F(t) 닫힌 식, 그래프의 C_b와 P_gp',
      pass:'질량 보존 ✓. 교란을 모두 끄면 2-5(배수 1)와 같은 결과가 됩니다.',
      warn:'P-gp가 줄면 F가 오르고 설사로 통과가 빨라지면 F가 내려가, 장염 때 두 효과가 겹칩니다. 기준 속도는 Cook 2022 Cmax에 맞춘 값(F 0.6 가정)이라 흡수가 관측보다 매우 빠릅니다. 투약 일정은 모델 1 기본(12 mg/kg, 하루 1회)에서 기간만 28일로 늘렸습니다. '+NO_CAT,next:'g5',show:['C_b','P_gp']},
    g5:{title:'2-5 · 분석 (배수로 본 민감도)',
      goal:'미생물을 빼고 k_in·k_out·k_tr 배수를 직접 바꿔 F와 농도가 어느 방향으로 바뀌는지 봅니다. 시나리오 겹쳐 그리기, 분배 프리셋 비교, 입구×출구 히트맵은 분석 화면에서 봅니다.',
      look:'변수 카드의 m_in·m_out·m_tr 슬라이더, 질량 보존',
      pass:'질량 보존 ✓. 배수가 모두 1이면 2-4에서 교란을 끈 결과와 같습니다.',
      warn:NO_CAT,next:null,show:['C_b'],link:{href:'analysis.html',label:'분석 화면 열기 (시나리오 · 프리셋 비교 · 히트맵)'}}
  };
  return {
    K0,BODY_SUM,gutModel,
    presets:{g1,g2,g3,g4,g5},
    stages:[['g1','2-1 로트카–볼테라'],['g2','2-2 교란·회복'],['g3','2-3 대사산물→P-gp'],['g4','2-4 PBPK 연결'],['g5','2-5 분석']],
    options:[['g1','2-1 · 로트카–볼테라 2군 경쟁 (공생균 vs 기회균)'],['g2','2-2 · 교란과 회복 (장염 · 항생제 · FIP)'],
      ['g3','2-3 · 대사산물 → P-gp 발현'],['g4','2-4 · PBPK 연결 (장 3구획 + 모델 1)'],['g5','2-5 · 분석 (배수 민감도 · 분석 화면)']],
    info,ann
  };
}

G.Ch2=Ch2;
G.STAGE_PACK={
  id:'ch2',
  title:'챕터 2 · 장내 미생물 → PBPK',
  brand:['챕터 2 · 장내 미생물 → PBPK','로트카–볼테라로 장내 미생물을 보고, 대사산물·P-gp를 거쳐 PBPK에 연결합니다'],
  keys:{model:'ch2-equation-builder-v1',presets:'ch2-builder-presets-v1',welcome:'ch2-builder-welcome-v1'},
  link:{href:'../index.html',label:'← 챕터 1 · PBPK 기본 모델'},
  start:'g1',startLabel:'2-1단계부터 시작',
  flowHtml:'<h3>2-1~2-5단계 흐름</h3><div class="scroll-x"><table>'+
    '<tr><th>단계</th><th>하는 일</th><th>확인할 것</th></tr>'+
    '<tr><td>2-1 로트카–볼테라</td><td>공생균 vs 기회균 2군 경쟁</td><td>로지스틱 해석해 ✓, 평형점</td></tr>'+
    '<tr><td>2-2 교란·회복</td><td>장염 · 항생제 · FIP 교란과 회복</td><td>교란을 끄면 평형 유지</td></tr>'+
    '<tr><td>2-3 대사산물→P-gp</td><td>대사산물과 P-gp 발현 (간접 반응)</td><td>평형에서 P_gp = 1</td></tr>'+
    '<tr><td>2-4 PBPK 연결</td><td>P-gp → k_out, 설사 → k_tr, 장 3구획 + 모델 1</td><td>질량 보존 ✓, 교란 전·중·후 비교</td></tr>'+
    '<tr><td>2-5 분석</td><td>k_in·k_out·k_tr 배수 민감도, 분석 화면</td><td>질량 보존 ✓</td></tr>'+
    '</table></div>',
  build:api=>Ch2(api)
};
})(globalThis);
