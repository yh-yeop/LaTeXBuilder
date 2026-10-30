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
    // 장 변수를 앞에 둔다 (변수 표에서 이 챕터의 변수가 먼저 보이도록). F·ka·IV 용량은 쓰지 않아 뺀다
    const body=m.vars.filter(v=>!['F','ka','Dose_IV'].includes(v.name));
    const K=(name,latex,x)=>PV(name,latex,x,0,(x>0?x:1)*8,'1/h');   // 0도 그대로 둔다 (극한 조건 검증용)
    m.vars=[
      K('k_in0','k_{in,0}',k0.k_in),K('k_out0','k_{out,0}',k0.k_out),K('k_b0','k_{b,0}',k0.k_b),K('k_tr0','k_{tr,0}',k0.k_tr),
      lg(PV('m_in','m_{in}',1,0.25,4,'배')),lg(PV('m_out','m_{out}',1,0.25,4,'배')),lg(PV('m_tr','m_{tr}',1,0.25,4,'배')),
      FV('k_in','k_{in}','k_in0*m_in','1/h'),FV('k_out','k_{out}','k_out0*m_out','1/h'),FV('k_b','k_b','k_b0','1/h'),FV('k_tr','k_{tr}','k_tr0*m_tr','1/h'),...body];
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
    m.vars.unshift(...lvVars(),...pertVars(),...pgpVars(),PV('m_dia','m_{dia}',2,1,5,'배'),
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
  // 식 변수 설명 (변수 표·발표용)
  Object.assign(ann,{
    xcs:tag('계산','공생균 평형점 (1 − a_co)/(1 − a_co·a_oc). 두 계수가 1보다 작을 때 의미가 있음'),
    xos:tag('계산','기회균 평형점 (1 − a_oc)/(1 − a_co·a_oc)'),
    W_en:tag('계산','장염 기간 창: 기간 중 1, 밖에서 0'),W_ab:tag('계산','항생제 기간 창: 기간 중 1, 밖에서 0'),
    H_fip:tag('계산','FIP 교란: 시작 시점 이후 계속 1'),
    L_c:tag('계산','공생균 추가 손실 속도의 합 (장염 + 항생제 + FIP)'),L_o:tag('계산','기회균 추가 손실 속도 (항생제)'),
    Stim:tag('계산','P-gp 발현 자극. 대사산물 S_m = 1(평형)에서 1, 0이면 1 − E_P'),
    k_in:tag('계산','입구 속도 = k_in,0 × m_in'),k_b:tag('계산','장 세포 → 혈액 속도 = k_b,0'),
    k_out:tag('계산','출구 속도 = k_out,0 × m_out (2-4에서는 × P_gp)'),k_tr:tag('계산','통과 속도 = k_tr,0 × m_tr (2-4에서는 장염 중 × m_dia)')
  });

  /* ---- 단계별 의도 · 해석 가이드 · 지금 결과 읽기 (발표용) ---- */
  function fmtN(x,p){ if(!Number.isFinite(x)) return String(x); return String(parseFloat(x.toPrecision(p))); }
  const f3=x=>fmtN(x,3), pct=x=>fmtN(x*100,3)+'%', day=hh=>fmtN(hh/24,3)+'일';
  const firstT=(T,V,pred,from)=>{ for(let k=0;k<T.length;k++) if(T[k]>=(from||0)&&pred(V[k])) return T[k]; return null; };
  const argExt=(T,V,sgn)=>{ let b=0; for(let k=1;k<V.length;k++) if(sgn*(V[k]-V[b])>0) b=k; return {v:V[b],t:T[b]}; };
  const below=(T,V,thr)=>{ let s=0; for(let k=1;k<T.length;k++){ if(V[k-1]<thr&&V[k]<thr) s+=T[k]-T[k-1]; } return s; };
  const eqOf=P=>{ const d=1-P.a_co*P.a_oc; return {c:(1-P.a_co)/d,o:(1-P.a_oc)/d}; };

  Object.assign(info.g1,{
    why:'장내 미생물 군집이 스스로 안정된 상태(평형)를 갖는다는 기준선을 세웁니다. 다음 단계들의 “정상 장 상태”가 바로 이 평형입니다.',
    guide:['x_c·x_o가 평평해지는 값이 평형점입니다. 변수 표의 x_c*, x_o*와 같으면 모델이 의도대로 작동하는 것입니다.',
      '경쟁자가 없는 y_c는 1까지 자랍니다. x_c 평형이 1보다 낮은 만큼이 기회균의 경쟁 효과입니다.',
      'a_co 또는 a_oc를 1 넘게 올리면 한 군이 밀려납니다(경쟁 배제). 발표에서 “균형이 깨지는 조건”을 보여 줄 때 씁니다.',
      '속도 r_c·r_o는 평형 위치를 바꾸지 않고 도달 시간만 바꿉니다.'],
    interpret(c){
      const P=c.P, xc=c.col('x_c'), xo=c.col('x_o'), eq=eqOf(P), out=[];
      const coex=P.a_co<1&&P.a_oc<1;
      out.push('경쟁 계수 a_co '+f3(P.a_co)+', a_oc '+f3(P.a_oc)+' → '+(coex?'두 군이 함께 살아남는 조건입니다.':'한 군이 밀려나는 조건(경쟁 배제)입니다. 평형점 닫힌 식은 이때 맞지 않습니다.'));
      out.push('끝값: 공생균 x_c '+f3(xc.at(-1))+(coex?' (평형 '+f3(eq.c)+')':'')+', 기회균 x_o '+f3(xo.at(-1))+(coex?' (평형 '+f3(eq.o)+')':'')+'.');
      if(coex){
        out.push('경쟁 때문에 공생균 평형이 단독일 때(1)보다 '+pct(1-eq.c)+' 낮습니다.');
        const t95=firstT(c.T,xc,v=>v>=0.95*eq.c);
        out.push(t95==null?'시뮬레이션 기간 안에 공생균이 평형의 95%에 닿지 않았습니다.':'공생균이 평형의 95%에 닿는 시간: 약 '+day(t95)+'.');
      }
      return out;
    }});
  Object.assign(info.g2,{
    why:'장 상태를 나쁘게 만드는 사건(장염·항생제·FIP)이 미생물 균형을 얼마나, 얼마 동안 흔드는지 봅니다. 회복 곡선을 따로 가정하지 않고 미생물 동역학에서 얻는 것이 핵심입니다.',
    guide:['공생균 x_c가 내려간 깊이(최저 %)와 다시 평형 근처로 돌아오는 시간이 이 단계의 결과입니다.',
      '공생균이 줄면 경쟁이 약해져 기회균 x_o가 늘어납니다(번성). 두 곡선이 반대로 움직이는지 보세요.',
      '교란이 끝난 뒤에도 회복에 며칠이 걸리는 것은 r_c와 경쟁 구조 때문입니다. FIP처럼 계속되는 교란은 원래 평형으로 돌아오지 않고 새 평형으로 옮겨 갑니다.',
      '교란 세기(mu_en, k_abc)와 기간(T_en, T_ab)은 가정입니다. 발표에서는 “이 정도 교란이면 이만큼 흔들린다”는 조건부 결과로 말하세요.'],
    interpret(c){
      const P=c.P, xc=c.col('x_c'), xo=c.col('x_o'), eq=eqOf(P), out=[];
      const on=[]; let tEnd=0;
      if(P.en_on>0){ on.push('장염('+day(P.t_en)+'부터 '+day(P.T_en)+')'); tEnd=Math.max(tEnd,P.t_en+P.T_en); }
      if(P.ab_on>0){ on.push('항생제('+day(P.t_ab)+'부터 '+day(P.T_ab)+')'); tEnd=Math.max(tEnd,P.t_ab+P.T_ab); }
      if(P.fip_on>0) on.push('FIP('+day(P.t_fip)+'부터 계속)');
      if(!on.length) return ['켜진 교란이 없습니다. 곡선이 평형에 그대로 머물면 정상입니다.'];
      out.push('켜진 교란: '+on.join(', ')+'.');
      const mn=argExt(c.T,xc,-1), mx=argExt(c.T,xo,1);
      out.push('공생균 최저 '+pct(mn.v/eq.c)+' (평형 대비, '+day(mn.t)+'), 기회균 최대 '+f3(mx.v/eq.o)+'배 ('+day(mx.t)+').');
      if(P.fip_on>0) out.push('FIP 교란이 계속되므로 끝값 '+pct(xc.at(-1)/eq.c)+'은 원래 평형이 아니라 새 평형 쪽입니다.');
      else if(tEnd>0){
        const t90=firstT(c.T,xc,v=>v>=0.9*eq.c,tEnd);
        out.push(t90==null?'교란이 끝난 뒤 시뮬레이션 끝까지 평형의 90%로 돌아오지 못했습니다.':'교란이 끝나고 평형의 90%로 돌아오는 데 약 '+day(t90-tEnd)+' 걸렸습니다. 끝값은 평형의 '+pct(xc.at(-1)/eq.c)+'.');
      }
      return out;
    }});
  Object.assign(info.g3,{
    why:'미생물 변화가 약물 수송체(P-gp)로 전달되는 경로를 만듭니다. 미생물이 회복된 뒤에도 수송체 변화가 남는 “시간차”가 여기서 생깁니다.',
    guide:['순서를 보세요: 공생균 x_c → 대사산물 S_m(빠르게 따라감) → P-gp 발현 P_gp(느리게 따라감).',
      'P_gp가 가장 낮은 시점이 공생균 최저보다 늦습니다. 이 지연이 다음 단계에서 “장염이 끝난 뒤의 효과”를 만듭니다.',
      'E_P는 P-gp가 대사산물에 얼마나 의존하는지, k_P는 얼마나 빨리 회복하는지입니다. 둘 다 가정이라 슬라이더로 결론이 바뀌는 범위를 확인해 두면 발표 질문에 답하기 좋습니다.',
      '방향(대사산물 감소 → P-gp 감소)은 문헌 확인(마우스·사람, 대장)이고, 크기와 속도는 가정입니다.'],
    interpret(c){
      const xc=c.col('x_c'), Sm=c.col('S_m'), Pg=c.col('P_gp'), out=[];
      const a=argExt(c.T,xc,-1), b=argExt(c.T,Sm,-1), p=argExt(c.T,Pg,-1);
      if(p.v>0.999) return ['P-gp가 거의 변하지 않았습니다 (최저 '+f3(p.v)+'). 교란이 꺼져 있거나 E_P가 작습니다.'];
      out.push('최저점 순서: 공생균 '+day(a.t)+' → 대사산물 '+day(b.t)+' → P-gp '+day(p.t)+' (P-gp는 공생균보다 '+fmtN(p.t-a.t,3)+' h 늦음).');
      out.push('P-gp 최저 '+pct(p.v)+' (기준 대비), 기준의 90% 아래였던 시간 '+day(below(c.T,Pg,0.9))+'.');
      out.push('끝값 P_gp '+f3(Pg.at(-1))+': '+(Pg.at(-1)>0.99?'시뮬레이션 끝에는 거의 회복했습니다.':'시뮬레이션 끝에도 아직 회복 중입니다.'));
      return out;
    }});
  Object.assign(info.g4,{
    why:'수송체 변화와 설사가 실제 혈중 농도와 F를 어떻게 바꾸는지 PBPK로 확인합니다. 두 효과가 반대 방향이라, 어느 쪽이 언제 우세한지가 결론을 정합니다.',
    guide:['P-gp 감소 → 출구(k_out) 감소 → F 증가. 설사 → 통과(k_tr) 증가 → F 감소. 두 효과가 반대입니다.',
      '노출 지표에서 “장염 중 / 교란 전” AUCτ 비율이 1보다 작으면 설사 효과가, 크면 P-gp 효과가 우세한 것입니다.',
      'F(t)가 장염이 끝난 뒤 기준보다 올라가면, 설사는 멈췄지만 P-gp가 아직 낮아 흡수가 늘어난 구간입니다 (2-3의 시간차).',
      '절대 농도보다 방향과 순서를 결론으로 쓰세요. m_dia, E_P, k_P를 바꿔 결론이 뒤집히는 지점을 찾으면 민감도 근거가 됩니다.',
      '기준 흡수가 관측보다 매우 빠르게 보정되어 있어(Tmax 약 0.13 h), Cmax 비교는 F·AUC 비교보다 덜 믿을 만합니다.'],
    interpret(c){
      const out=[], ex=c.exps, F=c.series('F_t'), F0=F[0];
      const pre=ex[0], dur=ex[1], last=ex[2];
      if(pre&&dur&&pre.auc>0){
        const r=dur.auc/pre.auc;
        out.push('장염 중 AUCτ는 교란 전의 '+f3(r)+'배 → '+(r<0.99?'이 구간에서는 설사(통과↑)로 인한 F 감소가 P-gp 감소 효과보다 큽니다.':r>1.01?'이 구간에서는 P-gp 감소로 인한 F 증가가 설사 효과보다 큽니다.':'두 효과가 거의 상쇄됩니다.'));
      }
      const lo=argExt(c.T,F,-1), hi=argExt(c.T,F,1);
      out.push('F(t) 범위: 최저 '+f3(lo.v)+' ('+day(lo.t)+') ~ 최고 '+f3(hi.v)+' ('+day(hi.t)+'), 기준 '+f3(F0)+'.');
      if(hi.v>F0*1.001&&c.P.en_on>0&&hi.t>=c.P.t_en+c.P.T_en) out.push('장염이 끝난 뒤 F(t)가 기준보다 '+pct(hi.v/F0-1)+' 높아지는 구간이 있습니다 → 설사는 멈췄지만 P-gp가 아직 회복 중이라 흡수가 늘어남.');
      if(pre&&last&&pre.auc>0) out.push('마지막 투약 간격 AUCτ는 교란 전의 '+f3(last.auc/pre.auc)+'배 → '+(Math.abs(last.auc/pre.auc-1)<0.01?'28일 시점에는 거의 원래대로 돌아왔습니다.':'28일 시점에도 차이가 남아 있습니다.'));
      return out;
    }});
  Object.assign(info.g5,{
    why:'미생물 모델의 가정과 떼어서, 어떤 수송체 변화가 F를 올리고 내리는지 일반적인 민감도로 확인합니다. 분석 화면에서는 분배 프리셋을 바꿔도 방향이 유지되는지 봅니다.',
    guide:['m_in(입구)↑ → F↑, m_out(출구, P-gp)↑ → F↓, m_tr(통과, 설사)↑ → F↓. 방향은 닫힌 식에서 항상 성립합니다.',
      '선형 모델이라 AUC0–∞ 비율은 F 비율과 정확히 같습니다. 그래서 F 비율 하나로 노출 변화를 말할 수 있습니다.',
      '크기는 기준 분배(입구 우세 / 균형 / 출구 우세)에 따라 달라집니다. 분석 화면의 “프리셋 3개에서 결론이 유지되는지” 표를 발표 근거로 쓰세요.',
      '히트맵의 점선(F 비율 = 1)은 입구·출구 변화가 서로 상쇄되는 조합입니다.'],
    interpret(c){
      const P=c.P, Fof=(mi,mo,mt)=>{ const a=P.k_in0*mi,o=P.k_out0*mo,b=P.k_b0,t=P.k_tr0*mt; return a*b/(a*b+t*(b+o)); };
      const F0=Fof(1,1,1), F=Fof(P.m_in,P.m_out,P.m_tr), r=F/F0;
      return ['지금 배수: 입구 ×'+f3(P.m_in)+', 출구 ×'+f3(P.m_out)+', 통과 ×'+f3(P.m_tr)+'.',
        'F = '+f3(F)+' (기준 '+f3(F0)+')로 기준의 '+f3(r)+'배 → '+(Math.abs(r-1)<1e-3?'기준과 같습니다.':r>1?'흡수가 늘어나는 방향입니다.':'흡수가 줄어드는 방향입니다.')+' AUC0–∞도 같은 비율로 바뀝니다.'];
    }});
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
  flowHtml:'<h3>2-1~2-5단계 흐름 (발표 순서)</h3><div class="scroll-x"><table>'+
    '<tr><th>단계</th><th>묻는 질문 (의도)</th><th>하는 일</th><th>확인할 것</th></tr>'+
    '<tr><td>2-1 로트카–볼테라</td><td>장내 미생물의 “정상 상태”는 무엇인가?</td><td>공생균 vs 기회균 2군 경쟁</td><td>로지스틱 해석해 ✓, 평형점</td></tr>'+
    '<tr><td>2-2 교란·회복</td><td>장염·항생제·FIP가 균형을 얼마나, 얼마 동안 흔드나?</td><td>교란과 회복</td><td>교란을 끄면 평형 유지, 최저점과 회복 시간</td></tr>'+
    '<tr><td>2-3 대사산물→P-gp</td><td>미생물 변화가 수송체로 어떻게, 얼마나 늦게 전달되나?</td><td>대사산물과 P-gp 발현 (간접 반응)</td><td>평형에서 P_gp = 1, 최저점 순서와 지연</td></tr>'+
    '<tr><td>2-4 PBPK 연결</td><td>그래서 혈중 농도와 F는 어느 방향으로, 언제 바뀌나?</td><td>P-gp → k_out, 설사 → k_tr, 장 3구획 + 모델 1</td><td>질량 보존 ✓, 교란 전·중·후 AUCτ와 F(t)</td></tr>'+
    '<tr><td>2-5 분석</td><td>그 결론은 가정(분배·배수)을 바꿔도 유지되나?</td><td>k_in·k_out·k_tr 배수 민감도, 분석 화면</td><td>질량 보존 ✓, 프리셋별 방향 유지</td></tr>'+
    '</table></div>'+
    '<p>각 단계 카드의 <b>의도</b>는 그 단계가 답하는 질문, <b>지금 결과 읽기</b>는 현재 값으로 만든 해석 문장, <b>해석 가이드</b>는 그래프를 읽는 법과 발표할 때 주의할 점입니다. 변수 카드의 <b>표</b> 보기로 단계의 변수를 한눈에 정리할 수 있습니다.</p>',
  build:api=>Ch2(api)
};
})(globalThis);
