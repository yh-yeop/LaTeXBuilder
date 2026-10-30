// 챕터 3 · FIP 바이러스 확산 → 약물 작용 단계 묶음.
// chapter3/index.html(챕터 1 편집기를 그대로 쓰는 페이지)이 STAGE_PACK으로 이 단계들을 불러온다.
//
// 구조는 사용자가 준 FIP 기전 자료(장 상피 감염 → 단핵구·대식세포 감염 → 혈관 통한 확산 →
// 사이토카인 증폭 → 혈관 투과성 증가 → 복수)를 따르고, 속도 값은 자료에 없어 모두 가정이다.
// 약물 작용(GS-441524 → 세포 내 활성 삼인산 → 바이러스 RNA 중합효소 억제)은 자료에 없는 부분이라
// 바이러스 생성 속도 p를 (1 − ε)로 줄이는 형태로만 넣었고, 세포 내 전환 과정은 모델에 없다.
//
// 시간 단위 h. 바이러스·세포 양은 절대 자료가 없어 상대량으로 둔다.
(function(G){
'use strict';

const NO_CAT='고양이 FIP의 바이러스 동역학 속도를 잰 자료는 없습니다. 아래 값은 구조를 보기 위한 가정이며, 결과는 모델로 본 경향이지 실측 예측이나 투약 판단에 쓰는 값이 아닙니다.';
const MW=291.3;             // GS-441524 분자량
// 기준값에서 나오는 감염 정상상태 (파라미터를 바꾸면 더 이상 정상상태가 아님)
const R0_DEF=4, T_EQ=0.25, I_EQ=0.15, V_EQ=150, CY_EQ=1, ASC_EQ=2/3;

function Ch3(api){
  const {PV,FV,T_}=api;
  const lg=v=>Object.assign(v,{log:true});

  /* ---- 바이러스 동역학 (자료 2단계: 단핵구·대식세포 감염) ---- */
  const virVars=()=>[
    PV('T0_m','T_{m,0}',1,0.1,5,'상대량'),PV('d_T','d_T',0.004,0,0.05,'1/h'),
    lg(PV('beta_V','\\beta',8e-5,1e-6,1e-2,'1/(상대량·h)')),PV('delta_I','\\delta_I',0.02,0,0.2,'1/h'),
    PV('p_V','p',100,0,500,'상대량/h'),PV('c_V','c',0.1,0,1,'1/h'),
    FV('s_T','s_T','d_T*T0_m','상대량/h'),
    FV('R0','R_0','beta_V*p_V*T0_m/(delta_I*c_V)','-')];
  // 표적 세포 T_m, 감염 세포 I_m, 바이러스 V_v. prod는 바이러스 생성 항(약물이 있으면 (1 − ε)가 곱해짐)
  const virEqs=(T0,I0,V0,prod)=>[
    {state:'T_m',latex:'T_m',cap:'1',ic:T0,unit:'상대량',terms:[T_(1,'s_T'),T_(-1,'d_T*T_m'),T_(-1,'beta_V*T_m*V_v')]},
    {state:'I_m',latex:'I_m',cap:'1',ic:I0,unit:'상대량',terms:[T_(1,'beta_V*T_m*V_v'),T_(-1,'delta_I*I_m')]},
    {state:'V_v',latex:'V',cap:'1',ic:V0,unit:'상대량',terms:[T_(1,prod),T_(-1,'c_V*V_v')]}];
  // 약물 효과 ε: Hill 식. EC50은 자료가 없어 가정이며 문헌 값으로 바꿔 써야 한다
  const drugVars=()=>[
    PV('Emax_d','E_{max}',1,0,1,'-'),lg(PV('EC50_d','EC_{50}',0.2,0.01,20,'µM')),PV('hill_d','h',1,0.5,4,'-'),
    FV('eps_crit','\\varepsilon_{crit}','1 - 1/R0','-')];
  const EPS=c=>'Emax_d*'+c+'^hill_d/(EC50_d^hill_d + '+c+'^hill_d)';

  /* ---- 염증 · 복수 (자료 4~5단계) ---- */
  const inflVars=()=>[
    PV('k_cy','k_{cy}',1/3,0,2,'1/h'),PV('d_cy','d_{cy}',0.05,0,0.5,'1/h'),
    PV('E_perm','E_{perm}',1,0,4,'-'),PV('Kcy_50','K_{cy}',0.5,0.05,5,'-'),
    PV('J_f','J_f',0.01,0,0.1,'L/h'),PV('k_lym','k_{lym}',0.01,0,0.2,'1/h'),
    FV('Perm','P_v','1 + E_perm*Cy/(Kcy_50 + Cy)','-')];
  const inflEqs=()=>[
    {state:'Cy',latex:'C_y',cap:'1',ic:CY_EQ,unit:'-',terms:[T_(1,'k_cy*I_m'),T_(-1,'d_cy*Cy')]},
    {state:'A_asc',latex:'A_{asc}',cap:'1',ic:ASC_EQ,unit:'L',terms:[T_(1,'J_f*(Perm - 1)'),T_(-1,'k_lym*A_asc')]}];

  /* ---- PBPK 연결 (챕터 1 3단계 모델 1 + 바이러스) ---- */
  function pbpkModel(opt){
    opt=opt||{};
    const m=api.presets.m1();
    m.vars=m.vars.filter(v=>v.name!=='Dose_IV');
    m.vars.unshift(...virVars(),...drugVars(),
      FV('C_uM','C_{µM}','1000/'+MW+'*C_b','µM'),
      FV('eps_t','\\varepsilon(t)',EPS('C_uM'),'-'),
      ...(opt.infl?inflVars():[]));
    m.eqs.unshift(...virEqs(T_EQ,I_EQ,V_EQ,'p_V*(1 - eps_t)*I_m'),...(opt.infl?inflEqs():[]));
    m.doses=[{on:true,label:'경구 투여',target:'A_gut',amt:'F*Dmg',start:'0',tau:'tau',n:'N_d'}];
    m.cmps=[m.cmps[0]];            // 질량 보존만 남긴다 (1구획 근사는 바이러스와 무관해 노이즈가 됨)
    m.opts.breakTerms=false;
    m.sim.method='explicit';       // 'auto'는 이 모델에서 Rodas3로 바뀌어 크게 느려짐
    m.sim.rtol=1e-7;
    return m;
  }
  const setV=(m,name,val)=>{ const v=m.vars.find(x=>x.name===name); v.value=val; v.expr=String(val); if(val>v.max) v.max=val*2; };

  function v1(){
    return api.normalize({
      vars:[...virVars(),PV('V0_v','V_0',1,0.01,100,'상대량'),
        FV('sg_V','\\sigma','delta_I + c_V','1/h'),
        FV('disc_V','\\Delta','sqrt((delta_I - c_V)^2 + 4*beta_V*T0_m*p_V)','1/h'),
        FV('lam1','\\lambda_1','(-sg_V + disc_V)/2','1/h'),FV('lam2','\\lambda_2','(-sg_V - disc_V)/2','1/h'),
        FV('t2x','t_{2x}','ln(2)/lam1','h')],
      eqs:[...virEqs(1,0,1,'p_V*I_m'),
        // 표적 세포가 줄지 않는다고 본 선형 근사 (해석해 대조용)
        {state:'I_l',latex:'I_{lin}',cap:'1',ic:0,unit:'상대량',terms:[T_(1,'beta_V*T0_m*V_l'),T_(-1,'delta_I*I_l')]},
        {state:'V_l',latex:'V_{lin}',cap:'1',ic:1,unit:'상대량',terms:[T_(1,'p_V*I_l'),T_(-1,'c_V*V_l')]}],
      doses:[],
      cmps:[{on:true,label:'초기 확산 해석해 (표적 세포 고정, V_lin)',sim:'V_l',kind:'ref',data:'',
        ref:'V0_v/(lam1 - lam2)*((lam1 + delta_I)*exp(lam1*t) - (lam2 + delta_I)*exp(lam2*t))'}],
      exps:[{on:true,label:'바이러스 V (0–30일)',expr:'V_v',scale:'1',t0:'0',t1:'720',thr:''}],
      sim:{t0:0,tEnd:720,tunit:'h',rtol:1e-11,method:'auto'},
      sweep:{on:false,name:'beta_V',from:2e-5,to:3.2e-4,n:5,log:true,show:'V_v'},
      opts:{cdot:true,breakTerms:false,logY:true}});
  }
  function v2(){
    return api.normalize({
      vars:[...virVars(),...drugVars(),lg(PV('C_drug','C',1,0.01,100,'µM')),
        FV('eps_d','\\varepsilon',EPS('C_drug'),'-'),FV('R0_eff','R_{0,eff}','R0*(1 - eps_d)','-')],
      eqs:virEqs(T_EQ,I_EQ,V_EQ,'p_V*(1 - eps_d)*I_m'),
      doses:[],cmps:[],
      exps:[{on:true,label:'바이러스 V (0–90일)',expr:'V_v',scale:'1',t0:'0',t1:'2160',thr:''},
        {on:true,label:'억제율 ε (일정)',expr:'eps_d',scale:'1',t0:'0',t1:'2160',thr:''}],
      sim:{t0:0,tEnd:2160,tunit:'h',rtol:1e-8,method:'auto'},
      sweep:{on:false,name:'C_drug',from:0.05,to:20,n:6,log:true,show:'V_v'},
      opts:{cdot:true,breakTerms:false,logY:true}});
  }
  function v3(){
    const m=pbpkModel();
    setV(m,'N_d',28);
    m.exps=[{on:true,label:'마지막 투약 간격 (µM)',expr:'C_b',scale:'1000/'+MW,t0:'(N_d-1)*tau',t1:'N_d*tau',thr:'3, 10'},
      {on:true,label:'억제율 ε(t) · 마지막 간격',expr:'eps_t',scale:'1',t0:'(N_d-1)*tau',t1:'N_d*tau',thr:''},
      {on:true,label:'바이러스 V (전체)',expr:'V_v',scale:'1',t0:'0',t1:'N_d*tau',thr:''}];
    m.sim.tEnd=672;
    m.sweep={on:false,name:'Dose_mgkg',from:2,to:20,n:5,log:false,show:'V_v'};
    m.opts.logY=true;
    return api.normalize(m);
  }
  function v4(){
    const m=pbpkModel({infl:true});
    setV(m,'N_d',28);
    m.exps=[{on:true,label:'바이러스 V (전체)',expr:'V_v',scale:'1',t0:'0',t1:'N_d*tau',thr:''},
      {on:true,label:'복수 부피 (L)',expr:'A_asc',scale:'1',t0:'0',t1:'N_d*tau',thr:''},
      {on:true,label:'염증 신호 C_y (기준 1)',expr:'Cy',scale:'1',t0:'0',t1:'N_d*tau',thr:''}];
    m.sim.tEnd=672;
    m.sweep={on:false,name:'E_perm',from:0.25,to:4,n:5,log:true,show:'A_asc'};
    m.opts.logY=true;   // V·C_y·복수의 크기가 많이 달라 로그 축이 읽기 쉽다
    return api.normalize(m);
  }
  function v5(){
    const m=v4();
    setV(m,'N_d',42);
    m.exps=[{on:true,label:'치료 중 (0–6주)',expr:'V_v',scale:'1',t0:'0',t1:'N_d*tau',thr:''},
      {on:true,label:'투약 종료 후 (6–12주)',expr:'V_v',scale:'1',t0:'N_d*tau',t1:'2016',thr:''},
      {on:true,label:'복수 부피 (L, 전체)',expr:'A_asc',scale:'1',t0:'0',t1:'2016',thr:''}];
    m.sim.tEnd=2016;
    m.sweep={on:false,name:'N_d',from:14,to:84,n:4,log:false,show:'V_v'};
    m.opts.logY=true;
    return api.normalize(m);
  }

  const tag=(t,n)=>[t,n];
  const ASM='고양이 FIP 실측 없음. 구조를 보기 위한 가정값';
  const ann={
    T0_m:tag('가정','감염되지 않은 표적 단핵구·대식세포 기준량. 상대 단위. '+ASM),
    d_T:tag('가정','표적 세포 교체 속도 (수명 약 10일 가정). '+ASM),
    beta_V:tag('가정','바이러스가 표적 세포를 감염시키는 속도. R_0를 정하는 값. '+ASM),
    delta_I:tag('가정','감염 세포 소실 속도 (반감기 약 35 h 가정). '+ASM),
    p_V:tag('가정','감염 세포 한 단위가 바이러스를 만드는 속도. '+ASM),
    c_V:tag('가정','바이러스 제거 속도 (반감기 약 7 h 가정). '+ASM),
    V0_v:tag('가정','초기 바이러스량 (V_v·V_lin의 초깃값과 같게 둘 것)'),
    s_T:tag('계산','표적 세포 공급 속도 = d_T · T_m,0 (감염이 없으면 T_m = T_m,0에서 평형)'),
    R0:tag('계산','기초감염재생산수 β·p·T_m,0 / (δ_I·c). 1보다 크면 감염이 퍼짐'),
    sg_V:tag('계산','선형 근사 고유값 계산용 합 δ_I + c'),disc_V:tag('계산','선형 근사 고유값 계산용 판별식'),
    lam1:tag('계산','초기 확산 속도 (양수면 바이러스가 늘어남)'),lam2:tag('계산','빠르게 사라지는 쪽 고유값'),
    t2x:tag('계산','초기 배가 시간 ln2 / λ₁'),
    Emax_d:tag('가정','약물의 최대 억제율. 1이면 완전 억제까지 가능'),
    EC50_d:tag('가정','억제율이 절반이 되는 농도. GS-441524의 FIPV 문헌 값으로 바꿔 쓸 것. '+ASM),
    hill_d:tag('가정','농도–효과 곡선의 기울기 (Hill 계수)'),
    C_drug:tag('가정','일정하게 유지한다고 본 약물 농도 (PBPK 없이 보는 단계)'),
    eps_d:tag('계산','일정 농도에서의 억제율 ε = E_max·C^h / (EC50^h + C^h)'),
    eps_crit:tag('계산','치료 임계 억제율 1 − 1/R_0. ε가 이 값을 넘어야 바이러스가 줄어듦'),
    R0_eff:tag('계산','약물이 있을 때의 재생산수 R_0·(1 − ε). 1보다 작아야 감소'),
    C_uM:tag('계산','혈장 농도 C_b를 µM로 환산 (×1000/'+MW+')'),
    eps_t:tag('계산','시각마다 바뀌는 억제율. 세포 내 활성 삼인산 전환은 모델에 없음 (가정)'),
    k_cy:tag('가정','감염 세포가 염증 신호를 만드는 속도. 기준 정상상태에서 C_y = 1이 되도록 맞춤'),
    d_cy:tag('가정','염증 신호 소실 속도'),
    E_perm:tag('가정','염증이 혈관 투과성을 올리는 최대 폭'),Kcy_50:tag('가정','투과성 반응의 반포화 염증 수준'),
    J_f:tag('가정','투과성이 1을 넘을 때 복강으로 빠져나가는 체액 속도'),
    k_lym:tag('가정','복수가 림프로 빠지는 속도'),
    Perm:tag('계산','혈관 투과성 (정상 1). 염증 신호가 올라가면 커짐'),
    Cy:tag('가정','TNF-α·IL-6 등 염증 신호를 하나로 묶은 값. 기준 정상상태에서 1'),
    A_asc:tag('가정','복수 부피. 약물 분포의 복수 구획(V_asc)에는 되먹이지 않음')
  };

  const info={
    v1:{title:'3-1 · 바이러스 확산 (단핵구·대식세포 감염)',
      goal:'표적 대식세포 T_m, 감염된 대식세포 I_m, 바이러스 V의 세 구획으로 FIP 바이러스가 퍼지는 과정을 봅니다. 표적 세포가 줄지 않는다고 본 선형 근사(V_lin)를 같이 두어 해석해로 계산을 검증합니다.',
      look:'요약 지표 아래 해석해 비교, 변수 카드의 R_0와 배가 시간 t_2x, 그래프의 V 곡선(로그 축)',
      pass:'해석해 비교 ✓. R_0가 1보다 크면 바이러스가 늘고, 늘어난 뒤에는 표적 세포가 줄면서 감염 정상상태(기본값 T_m 0.25 · I_m 0.15 · V 150)로 수렴합니다. 30일 시점은 아직 수렴 중이라 닫힌 식과 몇 % 차이가 납니다. 완전히 수렴하려면 종료 시간을 120일쯤으로 늘리세요.',
      warn:'세포·바이러스 양은 절대 자료가 없어 상대량입니다. 자료의 1단계(장 상피 감염)는 이 단계에 넣지 않았고, 단핵구·대식세포 감염부터 봅니다. '+NO_CAT,
      next:'v2',show:['T_m','I_m','V_v'],
      why:'FIP에서 바이러스가 퍼지는 힘이 얼마나 센지를 숫자 하나(R_0)로 정리합니다. 다음 단계의 치료 기준이 이 값에서 나옵니다.',
      guide:['R_0 = β·p·T_m,0 / (δ_I·c)입니다. 1보다 크면 퍼지고, 작으면 저절로 사라집니다.',
        '초기에는 V가 지수적으로 늘고(λ₁), 표적 세포가 줄면서 평평해집니다. 평평해진 값이 감염 정상상태입니다.',
        '자료의 “변이가 일어났다고 반드시 FIP가 되는 것은 아니다”는 점은 R_0로 표현됩니다. β나 p가 작으면 R_0가 1 아래로 내려가 감염이 퍼지지 않습니다.',
        '속도 값은 모두 가정입니다. 발표에서는 절대 수치가 아니라 “R_0가 이 정도일 때”라는 조건부로 말하세요.'],
      interpret(c){
        const P=c.P, V=c.col('V_v'), T=c.col('T_m'), out=[];
        const R0=P.beta_V*P.p_V*P.T0_m/(P.delta_I*P.c_V);
        const sg=P.delta_I+P.c_V, disc=Math.sqrt((P.delta_I-P.c_V)*(P.delta_I-P.c_V)+4*P.beta_V*P.T0_m*P.p_V), l1=(-sg+disc)/2;
        out.push('R_0 = '+c.f3(R0)+' → '+(R0>1?'바이러스가 퍼지는 조건입니다.':'감염이 저절로 사라지는 조건입니다 (R_0 < 1).'));
        if(R0>1){
          out.push('초기 확산 속도 λ₁ = '+c.f3(l1)+' /h → 배가 시간 약 '+c.f3(Math.log(2)/l1)+' h.');
          out.push('끝값: 바이러스 V '+c.f3(V.at(-1))+', 표적 세포 T_m '+c.f3(T.at(-1))+' (정상상태 닫힌 식 T_m,0/R_0 = '+c.f3(P.T0_m/R0)+').');
          out.push('감염 때문에 표적 세포가 처음의 '+c.pct(T.at(-1)/P.T0_m)+'까지 줄었습니다.');
        }else out.push('끝값 V '+c.f3(V.at(-1))+' (시작 '+c.f3(V[0])+').');
        return out;
      }},
    v2:{title:'3-2 · 약물 작용 (농도를 일정하게 둔 경우)',
      goal:'GS-441524가 바이러스 RNA 중합효소를 억제해 바이러스 생성 속도 p를 (1 − ε)로 줄인다고 보고, 농도 C를 일정하게 둔 채 억제율 ε이 얼마나 되어야 바이러스가 줄어드는지 봅니다.',
      look:'변수 카드의 ε, 치료 임계 ε_crit, R_0,eff, 그래프의 V 곡선. C 슬라이더를 움직여 보세요',
      pass:'ε > ε_crit = 1 − 1/R_0이면 바이러스가 0으로 사라집니다 (기본값 ε_crit = 0.75). 못 넘으면 사라지지는 않고, 더 낮은 새 정상상태로 내려가 거기 머뭅니다. ε = 0이면 시작한 정상상태에 그대로 있습니다.',
      warn:'세포 안에서 활성 삼인산으로 바뀌는 과정은 모델에 없고, 혈장 농도가 바로 작용한다고 봅니다. EC50은 가정값이라 문헌 값으로 바꿔 써야 합니다. 시작점은 기준값에서의 감염 정상상태라, 속도 변수를 바꾸면 시작점이 더 이상 정상상태가 아닙니다. '+NO_CAT,
      next:'v3',show:['T_m','I_m','V_v'],
      why:'“약이 바이러스를 어떻게 치료하는가”에 대한 정량적 답을 만듭니다. 치료 성공 조건이 ε > 1 − 1/R_0이라는 한 줄로 정리됩니다.',
      guide:['임계를 넘고 못 넘고의 차이는 “줄어드느냐”가 아니라 “사라지느냐”입니다. 임계 아래에서도 바이러스는 일단 줄어들지만, 0이 아닌 새 정상상태에 머뭅니다.',
        'R_0,eff = R_0·(1 − ε)가 1보다 작으면 바이러스가 사라지고, 1보다 크면 V′ = p(1 − ε)·s(1 − 1/R_0,eff)/(δ_I·c)로 내려가 머뭅니다. 이 한 줄이 발표의 핵심 결론입니다.',
        '처음에는 임계 아래에서도 V가 뚜렷하게 떨어집니다. 시작점이 표적 세포가 이미 줄어든 감염 정상상태이기 때문입니다. 짧게만 보면 치료가 된 것처럼 보이니 끝까지 보세요.',
        'EC50을 올리면(약이 덜 들으면) 같은 농도에서 ε이 작아져 치료 임계를 못 넘습니다. R_0가 크면 임계가 높아져 더 높은 농도가 필요합니다.',
        'C를 스윕해 임계 농도를 찾아 보세요. C_crit = EC50·(ε_crit/(E_max − ε_crit))^(1/h)입니다.'],
      interpret(c){
        const P=c.P, V=c.col('V_v'), out=[];
        const R0=P.beta_V*P.p_V*P.T0_m/(P.delta_I*P.c_V);
        const eps=P.Emax_d*Math.pow(P.C_drug,P.hill_d)/(Math.pow(P.EC50_d,P.hill_d)+Math.pow(P.C_drug,P.hill_d));
        const crit=1-1/R0, reff=R0*(1-eps);
        out.push('농도 C = '+c.f3(P.C_drug)+' µM → 억제율 ε = '+c.f3(eps)+', 치료 임계 ε_crit = '+c.f3(crit)+'.');
        if(reff<1) out.push('R_0,eff = '+c.f3(reff)+' → 1보다 작아 바이러스가 0으로 사라집니다.');
        else{
          const Is=P.d_T*P.T0_m*(1-1/reff)/P.delta_I, Vs=P.p_V*(1-eps)*Is/P.c_V;
          out.push('R_0,eff = '+c.f3(reff)+' → 1보다 커서 사라지지 않고, 더 낮은 새 정상상태 V ≈ '+c.f3(Vs)+' (시작의 '+c.pct(Vs/V[0])+')로 내려가 머뭅니다.');
        }
        if(P.Emax_d>crit){
          const cc=P.EC50_d*Math.pow(crit/(P.Emax_d-crit),1/P.hill_d);
          out.push('임계 농도(닫힌 식) 약 '+c.f3(cc)+' µM → 지금 농도는 그보다 '+(P.C_drug>=cc?'높습니다.':'낮습니다.'));
        }else out.push('E_max('+c.f3(P.Emax_d)+')가 치료 임계보다 작아, 농도를 아무리 올려도 바이러스를 줄일 수 없는 설정입니다.');
        const r=V.at(-1)/V[0];
        out.push('90일 뒤 V는 시작의 '+(r<0.01?c.f3(r)+'배 ('+c.f3(Math.log10(1/r))+' log10 감소)':c.f3(r)+'배')+'.');
        return out;
      }},
    v3:{title:'3-3 · PBPK 연결 (투약 → 농도 → 억제율 → 바이러스)',
      goal:'챕터 1의 3단계 모델 1로 경구 투약 농도를 계산하고, 그 혈장 농도에서 시각마다 억제율 ε(t)를 만들어 바이러스 동역학에 넣습니다. 농도가 투약 간격 안에서 오르내리므로 ε도 함께 오르내립니다.',
      look:'노출 지표의 마지막 간격 µM·ε(t)·V, 그래프에서 C_b와 V를 함께 보기, 아래 Cooke 목표 대비 줄',
      pass:'질량 보존 ✓. 농도가 임계 위에 충분히 머무르면 V가 줄고, 아니면 줄지 않습니다.',
      warn:'ε는 혈장 농도로 계산합니다. 세포 안 활성 대사물 농도는 모델에 없습니다. 대식세포가 모여 있는 복수·조직의 농도를 쓰려면 식에서 C_b 대신 C_asc 등을 넣으면 됩니다. '+NO_CAT,
      next:'v4',show:['C_b','V_v'],hideCmp:[0],
      why:'챕터 1(약이 몸에서 어떻게 움직이나)과 3-1·3-2(바이러스와 약 효과)를 하나로 잇습니다. 용량과 간격이 바이러스 감소로 이어지는 경로가 여기서 완성됩니다.',
      guide:['순서를 보세요: 투약 → C_b(오르내림) → ε(t)(오르내림) → 바이러스 생성 억제 → V 감소.',
        '농도가 높은 구간에서만 ε이 임계를 넘습니다. 간격 안에서 임계를 넘는 시간이 얼마나 되는지가 중요합니다.',
        '용량(Dose_mgkg)을 스윕하면 치료가 되는 용량과 안 되는 용량의 경계가 보입니다. 다만 이 경계는 가정한 EC50과 R_0에 전적으로 달려 있습니다.',
        '절대 농도나 용량을 결론으로 쓰지 마세요. “EC50과 R_0가 이 범위면 경계가 여기쯤”이라는 조건부로 말해야 합니다.'],
      interpret(c){
        const V=c.col('V_v'), ex=c.exps, out=[];
        const uM=ex[0], eps=ex[1];
        const P=c.P, R0=P.beta_V*P.p_V*P.T0_m/(P.delta_I*P.c_V), crit=1-1/R0;
        if(uM) out.push('마지막 투약 간격: 최고 '+c.f3(uM.mx)+' µM, 간격 끝 '+c.f3(uM.trough)+' µM.');
        if(eps){
          const avg=eps.auc/(eps.b-eps.a);
          out.push('그 간격의 평균 억제율 ε ≈ '+c.f3(avg)+' (최고 '+c.f3(eps.mx)+', 끝 '+c.f3(eps.trough)+'), 치료 임계 '+c.f3(crit)+'.');
        }
        const r=V.at(-1)/V[0];
        out.push('바이러스는 시작의 '+c.f3(r)+'배'+(r<1?' ('+c.f3(Math.log10(1/r))+' log10 감소)':'')+' → '+(r<0.5?'투약 기간 동안 줄었습니다.':r>1.5?'줄지 않고 오히려 늘었습니다.':'거의 변하지 않았습니다.'));
        return out;
      }},
    v4:{title:'3-4 · 염증과 복수 (습식 FIP)',
      goal:'감염된 대식세포가 염증 신호 C_y를 만들고, 그 신호가 혈관 투과성을 올려 복강에 체액이 쌓이는 과정을 더합니다. 자료의 4~5단계(사이토카인 증폭 → 혈관 투과성 증가 → 복수)에 해당합니다.',
      look:'그래프의 V · C_y · A_asc 순서, 노출 지표의 복수 부피 변화',
      pass:'질량 보존 ✓ (약물). 치료로 V가 줄면 C_y가 줄고, 이어서 복수가 줄어듭니다. 세 곡선의 순서가 중요합니다.',
      warn:'복수 부피 A_asc는 약물 분포의 복수 구획(V_asc)에 되먹이지 않습니다. 즉 복수가 줄어도 약물 분포는 그대로입니다. 염증 매개물질을 C_y 하나로 묶었고, 자료의 항체·보체(ADE)와 건식 장기 병변은 이 초안에 없습니다. '+NO_CAT,
      next:'v5',show:['V_v','Cy','A_asc'],hideCmp:[0],
      why:'“바이러스가 줄면 증상이 왜 좋아지는가”를 모델 안에서 보여 줍니다. 바이러스 → 염증 → 복수로 이어지는 시간차가 핵심입니다.',
      guide:['순서를 보세요: V 감소 → C_y 감소(조금 늦게) → 복수 A_asc 감소(더 늦게).',
        '복수가 줄어드는 속도는 k_lym(림프 배출)이 정합니다. 바이러스가 빨리 줄어도 복수는 천천히 빠집니다.',
        'E_perm을 스윕하면 같은 염증에서도 복수가 얼마나 생기는지가 달라집니다. 습식과 건식의 차이를 설명할 때 쓸 수 있습니다.',
        '복수 부피의 절대값은 가정에서 나온 값이라, 변화 방향과 시간 순서만 결론으로 쓰세요.'],
      interpret(c){
        const V=c.col('V_v'), Cy=c.col('Cy'), A=c.col('A_asc'), out=[];
        const half=(T,X)=>{ const t0=X[0]; for(let k=0;k<X.length;k++) if(X[k]<=t0/2) return T[k]; return null; };
        out.push('끝값: 바이러스 '+c.pct(V.at(-1)/V[0])+', 염증 C_y '+c.pct(Cy.at(-1)/Cy[0])+', 복수 '+c.pct(A.at(-1)/A[0])+' (각각 시작 대비).');
        const hv=half(c.T,V), hc=half(c.T,Cy), ha=half(c.T,A);
        const d=x=>x==null?'도달 못 함':c.f3(x/24)+'일';
        out.push('절반으로 줄어드는 시간: 바이러스 '+d(hv)+' → 염증 '+d(hc)+' → 복수 '+d(ha)+'.');
        if(hv!=null&&ha!=null) out.push('복수가 바이러스보다 '+c.f3((ha-hv)/24)+'일 늦게 반응합니다 → 바이러스가 먼저 잡히고 증상이 뒤따라 좋아지는 순서입니다.');
        out.push('복수 '+c.f3(A[0])+' L → '+c.f3(A.at(-1))+' L.');
        return out;
      }},
    v5:{title:'3-5 · 치료 기간과 투약 종료 후',
      goal:'투약을 6주(기본 42회)에서 멈추고 그 뒤 6주를 더 계산해, 바이러스가 다시 늘어나는지 봅니다. 치료 기간을 스윕하면 기간에 따라 결과가 어떻게 달라지는지 비교할 수 있습니다.',
      look:'노출 지표의 치료 중 / 투약 종료 후 두 구간, 그래프에서 투약이 끊긴 뒤의 V 곡선',
      pass:'정답이 있는 단계가 아닙니다. 투약 종료 시점의 V가 충분히 낮고 표적 세포가 회복되지 않았다면 반등이 늦고, 아니면 빨리 돌아옵니다.',
      warn:'실제 재발은 면역 반응·중추신경계 침범 등 이 모델에 없는 요인이 크게 작용합니다. 모델이 말하는 것은 “바이러스 동역학만 보면 이렇게 된다”까지입니다. 투약 기간을 권하는 근거로 쓸 수 없습니다. '+NO_CAT,
      next:null,show:['V_v','A_asc'],hideCmp:[0],
      why:'치료를 얼마나 오래 해야 하는가라는 질문을, 모델이 답할 수 있는 범위 안에서만 다룹니다. 모델의 한계를 보여 주는 단계이기도 합니다.',
      guide:['투약이 끊기면 ε이 0으로 떨어지고, 남아 있는 바이러스가 다시 R_0로 늘어납니다.',
        '반등 속도는 종료 시점의 V와 표적 세포 T_m 회복 정도가 정합니다. T_m이 많이 회복돼 있으면 더 빨리 늘어납니다.',
        'N_d를 스윕해 기간별 곡선을 겹쳐 보세요. 다만 이 모델에는 면역 제거가 없어서, 바이러스가 0이 되지 않는 한 언젠가는 돌아옵니다. 이것은 모델의 구조적 한계입니다.',
        '실제 치료 기간의 근거로 쓸 수 없다는 점을 발표에서 분명히 하세요.'],
      interpret(c){
        const P=c.P, V=c.col('V_v'), T=c.col('T_m'), out=[];
        const tStop=P.N_d*P.tau;
        const vStop=c.interp1(c.T,V,tStop), tStopT=c.interp1(c.T,T,tStop);
        out.push('투약은 '+c.f3(tStop/24)+'일에 끝납니다 ('+Math.round(P.N_d)+'회).');
        out.push('종료 시점: 바이러스 '+c.f3(vStop)+' (시작의 '+c.pct(vStop/V[0])+'), 표적 세포 '+c.pct(tStopT/P.T0_m)+' 회복.');
        const last=V.at(-1), r=last/vStop;
        out.push('종료 후 끝까지: V '+c.f3(vStop)+' → '+c.f3(last)+' ('+c.f3(r)+'배) → '+(r>2?'다시 늘어났습니다(반등).':r<0.5?'계속 줄었습니다.':'거의 그대로입니다.'));
        return out;
      }}
  };

  return {R0_DEF,virVars,virEqs,drugVars,pbpkModel,presets:{v1,v2,v3,v4,v5},
    stages:[['v1','3-1 바이러스 확산'],['v2','3-2 약물 작용'],['v3','3-3 PBPK 연결'],['v4','3-4 염증·복수'],['v5','3-5 치료 기간']],
    options:[['v1','3-1 · 바이러스 확산 (단핵구·대식세포 감염)'],['v2','3-2 · 약물 작용 (농도 일정)'],
      ['v3','3-3 · PBPK 연결 (투약 → 억제율 → 바이러스)'],['v4','3-4 · 염증과 복수 (습식 FIP)'],['v5','3-5 · 치료 기간과 투약 종료 후']],
    info,ann};
}

G.Ch3=Ch3;
G.STAGE_PACK={
  id:'ch3',
  title:'챕터 3 · FIP 바이러스와 약물 작용',
  brand:['챕터 3 · FIP 바이러스와 약물 작용','대식세포 감염으로 바이러스가 퍼지는 과정과, 약이 그것을 억제하는 과정을 잇습니다'],
  keys:{model:'ch3-equation-builder-v1',presets:'ch3-builder-presets-v1',welcome:'ch3-builder-welcome-v1'},
  links:[{href:'../index.html',label:'← 챕터 1 · PBPK 기본 모델'},{href:'../chapter2/',label:'챕터 2 · 장내 미생물'}],
  start:'v1',startLabel:'3-1단계부터 시작',
  flowHtml:'<h3>3-1~3-5단계 흐름 (발표 순서)</h3><div class="scroll-x"><table>'+
    '<tr><th>단계</th><th>묻는 질문 (의도)</th><th>하는 일</th><th>확인할 것</th></tr>'+
    '<tr><td>3-1 바이러스 확산</td><td>바이러스가 퍼지는 힘은 얼마나 센가?</td><td>표적·감염 대식세포와 바이러스 3구획</td><td>해석해 ✓, R_0와 배가 시간</td></tr>'+
    '<tr><td>3-2 약물 작용</td><td>약이 얼마나 억제해야 바이러스가 사라지나?</td><td>농도를 일정하게 두고 억제율 ε 적용</td><td>ε > 1 − 1/R_0 경계</td></tr>'+
    '<tr><td>3-3 PBPK 연결</td><td>실제 투약 농도로는 그 경계를 넘나?</td><td>모델 1 농도 → ε(t) → 바이러스</td><td>질량 보존 ✓, 간격 내 ε과 V 감소</td></tr>'+
    '<tr><td>3-4 염증·복수</td><td>바이러스가 줄면 증상은 언제 좋아지나?</td><td>염증 신호 → 혈관 투과성 → 복수</td><td>V → C_y → 복수의 시간 순서</td></tr>'+
    '<tr><td>3-5 치료 기간</td><td>투약을 멈추면 어떻게 되나?</td><td>투약 종료 후 경과와 기간 스윕</td><td>반등 여부 (모델 한계 확인)</td></tr>'+
    '</table></div>'+
    '<p>구조는 FIP 기전 자료(장 상피 감염 → 대식세포 감염 → 혈관 통한 확산 → 사이토카인 → 혈관 투과성 → 복수)를 따랐고, 속도 값은 자료에 없어 모두 가정입니다. 자료의 장관 감염(1단계), 항체·보체(ADE), 건식 장기 병변은 이 초안에 넣지 않았습니다.</p>',
  build:api=>Ch3(api)
};
})(globalThis);
