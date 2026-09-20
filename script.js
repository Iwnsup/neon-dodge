/* Neon Dodge: a small, self-contained arcade game driven by one requestAnimationFrame loop. */
(() => {
  'use strict';
  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const $ = (selector) => document.querySelector(selector);
  const ui = { score:$('#score'), time:$('#time'), high:$('#highScore'), level:$('#level'), hp:$('#healthPips'), effects:$('#effects'), toast:$('#toast'), menuBest:$('#menuHighScore'), finalScore:$('#finalScore'), finalTime:$('#finalTime'), finalLevel:$('#finalLevel'), finalBest:$('#finalBest'), newBest:$('#newBest') };
  const panels = { menu:$('#menuPanel'), pause:$('#pausePanel'), over:$('#gameOverPanel') };
  const MAX_HP = 3, TAU = Math.PI * 2, storageKey = 'neon-dodge-high-score';
  let state = 'MENU', highScore = Number(localStorage.getItem(storageKey)) || 0;
  let audioMuted = false, audioContext = null, lastFrame = 0, toastTimer = 0;

  const input = { keys:new Set(), pointer:{x:0,y:0,active:false}, touch:{x:0,y:0,active:false} };
  const game = { score:0, elapsed:0, level:1, hp:MAX_HP, spawnTimer:0, powerTimer:0, shake:0, shield:0, boost:0, hitInvuln:0, obstacles:[], powerups:[], particles:[], stars:[] };
  const player = { x:480, y:520, vx:0, vy:0, radius:15, angle:0 };

  const random = (min,max) => min + Math.random() * (max-min);
  const clamp = (value,min,max) => Math.max(min, Math.min(max,value));
  const formatScore = (n) => String(Math.floor(n)).padStart(6,'0');
  const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
  const showPanel = (name) => Object.entries(panels).forEach(([key,panel]) => panel.classList.toggle('active', key === name));

  function sound(kind) {
    if (audioMuted) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const frequencies = { collect:660, hit:110, over:75, high:880, start:440 };
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = kind === 'hit' ? 'sawtooth' : 'square'; oscillator.frequency.value = frequencies[kind] || 440;
      gain.gain.setValueAtTime(0.045, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + (kind === 'over' ? .5 : .13));
      oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .51);
    } catch (_) { /* Audio is an enhancement; gameplay never depends on it. */ }
  }

  function resetGame() {
    Object.assign(game, { score:0, elapsed:0, level:1, hp:MAX_HP, spawnTimer:.2, powerTimer:random(8,13), shake:0, shield:0, boost:0, hitInvuln:0 });
    game.obstacles.length = 0; game.powerups.length = 0; game.particles.length = 0;
    Object.assign(player, { x:canvas.width/2, y:canvas.height-75, vx:0, vy:0, angle:0 });
    for (let i=0; i<65; i++) game.stars.push({x:random(0,canvas.width), y:random(0,canvas.height), size:random(.4,1.8), speed:random(8,28)});
    updateHud();
  }

  function startGame() { resetGame(); state = 'PLAYING'; showPanel(null); sound('start'); }
  function pauseGame() { if (state === 'PLAYING') { state = 'PAUSED'; showPanel('pause'); } else if (state === 'PAUSED') { state = 'PLAYING'; showPanel(null); lastFrame = performance.now(); } }
  function endGame() {
    state = 'GAME_OVER'; showPanel('over'); const final = Math.floor(game.score), isNew = final > highScore;
    if (isNew) { highScore = final; localStorage.setItem(storageKey, highScore); sound('high'); } else sound('over');
    ui.finalScore.textContent = formatScore(final); ui.finalTime.textContent = formatTime(game.elapsed); ui.finalLevel.textContent = `LEVEL ${game.level}`; ui.finalBest.textContent = formatScore(highScore); ui.newBest.style.visibility = isNew ? 'visible' : 'hidden'; updateHud();
  }

  function spawnObstacle() {
    const roll = Math.random(), type = roll < Math.min(.12 + game.level*.018,.23) ? 'heavy' : roll < Math.min(.34 + game.level*.025,.52) ? 'fast' : 'normal';
    const specs = { normal:{radius:random(16,24), speed:random(115,165), damage:1, color:'#ff4e76'}, fast:{radius:random(10,16), speed:random(220,290), damage:1, color:'#ffcf5c'}, heavy:{radius:random(25,34), speed:random(75,105), damage:2, color:'#a36bff'} };
    const spec = specs[type]; game.obstacles.push({ x:random(spec.radius,canvas.width-spec.radius), y:-spec.radius-5, ...spec, type, rotation:random(0,TAU), spin:random(-2.5,2.5), seed:random(0,100) });
  }
  function spawnPowerup() { const types = ['health','shield','boost']; const type = types[Math.floor(Math.random()*types.length)]; game.powerups.push({ type, x:random(30,canvas.width-30), y:-25, radius:14, speed:random(65,90), pulse:0 }); }

  function addParticles(x,y,color,count=10,force=80) { for (let i=0;i<count;i++) { const angle=random(0,TAU), speed=random(force*.25,force); game.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:random(.3,.75),max:.75,size:random(1,3),color}); } }
  function hitPlayer(obstacle) {
    if (game.hitInvuln > 0 || game.shield > 0) { addParticles(obstacle.x, obstacle.y, '#40f6ff', 8, 55); return; }
    game.hp = Math.max(0, game.hp - obstacle.damage); game.hitInvuln = 1; game.shake = 10; addParticles(player.x,player.y,'#ff3f9f',22,150); sound('hit');
    if (game.hp <= 0) endGame();
  }
  function collectPowerup(item) {
    if (item.type === 'health') { if (game.hp < MAX_HP) game.hp++; else game.score += 50; showToast(game.hp < MAX_HP ? '+1 HP' : '+50 BONUS'); }
    if (item.type === 'shield') { game.shield=5; showToast('SHIELD ONLINE'); }
    if (item.type === 'boost') { game.boost=5; showToast('SCORE x2'); }
    addParticles(item.x,item.y,item.type==='health'?'#72ff9c':item.type==='shield'?'#40f6ff':'#ffdc68',18,100); sound('collect');
  }
  function showToast(message) { ui.toast.textContent = message; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>ui.toast.classList.remove('show'),1100); }

  function update(dt) {
    game.elapsed += dt; game.level = Math.min(12, 1 + Math.floor(game.elapsed/15));
    game.score += dt * 10 * (game.boost > 0 ? 2 : 1); game.hitInvuln = Math.max(0,game.hitInvuln-dt); game.shield=Math.max(0,game.shield-dt); game.boost=Math.max(0,game.boost-dt); game.shake=Math.max(0,game.shake-dt*24);
    const difficulty = 1 + Math.min(game.elapsed/180, .72);
    const acceleration = 900, maxSpeed = 300; let dx=0,dy=0;
    if (input.keys.has('ArrowLeft')||input.keys.has('a')) dx--; if (input.keys.has('ArrowRight')||input.keys.has('d')) dx++; if (input.keys.has('ArrowUp')||input.keys.has('w')) dy--; if (input.keys.has('ArrowDown')||input.keys.has('s')) dy++;
    if (input.touch.active) { dx = clamp((input.touch.x-player.x)/55,-1,1); dy=clamp((input.touch.y-player.y)/55,-1,1); }
    if (input.pointer.active && !('ontouchstart' in window)) { dx=clamp((input.pointer.x-player.x)/90,-1,1); dy=clamp((input.pointer.y-player.y)/90,-1,1); }
    player.vx += dx*acceleration*dt; player.vy += dy*acceleration*dt; player.vx *= Math.pow(.0008,dt); player.vy *= Math.pow(.0008,dt); player.vx=clamp(player.vx,-maxSpeed,maxSpeed); player.vy=clamp(player.vy,-maxSpeed,maxSpeed);
    player.x=clamp(player.x+player.vx*dt,24,canvas.width-24); player.y=clamp(player.y+player.vy*dt,55,canvas.height-25); player.angle=player.vx*.001;
    game.spawnTimer -= dt; if (game.spawnTimer <= 0) { spawnObstacle(); game.spawnTimer = Math.max(.28, .92 - game.level*.045) * random(.72,1.12); }
    game.powerTimer -= dt; if (game.powerTimer <= 0) { if (game.obstacles.length < 18) spawnPowerup(); game.powerTimer=random(10,17); }
    for (let i=game.obstacles.length-1;i>=0;i--) { const o=game.obstacles[i]; o.y += o.speed*difficulty*dt; o.rotation += o.spin*dt; if (Math.hypot(player.x-o.x,player.y-o.y) < player.radius+o.radius*.72) { hitPlayer(o); game.obstacles.splice(i,1); continue; } if (o.y-o.radius>canvas.height) game.obstacles.splice(i,1); }
    for (let i=game.powerups.length-1;i>=0;i--) { const p=game.powerups[i]; p.y+=p.speed*dt;p.pulse+=dt*4; if(Math.hypot(player.x-p.x,player.y-p.y)<player.radius+p.radius) { collectPowerup(p);game.powerups.splice(i,1); } else if(p.y-p.radius>canvas.height) game.powerups.splice(i,1); }
    for (let i=game.particles.length-1;i>=0;i--) { const p=game.particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;p.life-=dt;if(p.life<=0)game.particles.splice(i,1); }
    game.stars.forEach(s=>{s.y+=s.speed*dt*(1+game.level*.04);if(s.y>canvas.height)s.y=-2;}); updateHud();
  }

  function updateHud() { ui.score.textContent=formatScore(game.score);ui.time.textContent=formatTime(game.elapsed);ui.high.textContent=formatScore(highScore);ui.menuBest.textContent=formatScore(highScore);ui.level.textContent=`LEVEL ${game.level}`;ui.hp.innerHTML='';for(let i=0;i<MAX_HP;i++){const pip=document.createElement('i');pip.className=`health-pip ${i>=game.hp?'empty':''}`;ui.hp.appendChild(pip);}ui.effects.innerHTML='';if(game.shield>0)ui.effects.innerHTML+='<span class="effect">SHIELD '+Math.ceil(game.shield)+'s</span>';if(game.boost>0)ui.effects.innerHTML+='<span class="effect">x2 SCORE '+Math.ceil(game.boost)+'s</span>'; }

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.save(); if(game.shake)ctx.translate(random(-game.shake,game.shake),random(-game.shake,game.shake));
    const gradient=ctx.createLinearGradient(0,0,0,canvas.height);gradient.addColorStop(0,'#09112e');gradient.addColorStop(1,'#050716');ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#1a2a55';ctx.globalAlpha=.35;ctx.lineWidth=1;for(let x=0;x<canvas.width;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}for(let y=40;y<canvas.height;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}ctx.globalAlpha=1;
    game.stars.forEach(s=>{ctx.fillStyle=`rgba(130,190,255,${.25+s.size/5})`;ctx.fillRect(s.x,s.y,s.size,s.size*2);});
    game.obstacles.forEach(drawObstacle); game.powerups.forEach(drawPowerup); game.particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.shadowBlur=10;ctx.shadowColor=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,TAU);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;}); drawPlayer(); ctx.restore();
  }
  function drawObstacle(o) { ctx.save();ctx.translate(o.x,o.y);ctx.rotate(o.rotation);ctx.shadowBlur=18;ctx.shadowColor=o.color;ctx.fillStyle=o.color;ctx.strokeStyle='#fff';ctx.globalAlpha=.9;ctx.beginPath();for(let i=0;i<8;i++){const a=i*TAU/8,r=o.radius*(.78+Math.sin(o.seed+i*4)*.18);ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.globalAlpha=.35;ctx.stroke();ctx.restore(); }
  function drawPowerup(p) { const color=p.type==='health'?'#72ff9c':p.type==='shield'?'#40f6ff':'#ffdc68';ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.pulse*.25);ctx.shadowBlur=20;ctx.shadowColor=color;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,p.radius+Math.sin(p.pulse)*2,0,TAU);ctx.stroke();ctx.fillStyle=color;ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.type==='health'?'+':p.type==='shield'?'S':'×2',0,1);ctx.restore(); }
  function drawPlayer() { const blinking=game.hitInvuln>0&&Math.floor(game.hitInvuln*12)%2===0;if(blinking)return;ctx.save();ctx.translate(player.x,player.y);ctx.rotate(player.angle);ctx.shadowBlur=22;ctx.shadowColor=game.shield>0?'#40f6ff':'#ff3f9f';ctx.fillStyle='#f4f7ff';ctx.strokeStyle=game.shield>0?'#40f6ff':'#ff3f9f';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-19);ctx.lineTo(14,14);ctx.lineTo(0,9);ctx.lineTo(-14,14);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#40f6ff';ctx.beginPath();ctx.arc(0,-4,4,0,TAU);ctx.fill();ctx.fillStyle='#ff4e76';ctx.beginPath();ctx.moveTo(-5,13);ctx.lineTo(0,24+Math.random()*5);ctx.lineTo(5,13);ctx.fill();if(game.shield>0){ctx.strokeStyle='#40f6ff88';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,27+Math.sin(game.elapsed*8)*2,0,TAU);ctx.stroke();}ctx.restore(); }

  function loop(timestamp) { const dt=Math.min(.033,(timestamp-lastFrame)/1000||0);lastFrame=timestamp;if(state==='PLAYING')update(dt);draw();requestAnimationFrame(loop); }
  function pointerPosition(event) { const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height}; }
  window.addEventListener('keydown',(event)=>{const key=event.key.length===1?event.key.toLowerCase():event.key;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key))event.preventDefault();if(key==='p'||key==='Escape'){pauseGame();return;}input.keys.add(key);});
  window.addEventListener('keyup',(event)=>input.keys.delete(event.key.length===1?event.key.toLowerCase():event.key));
  canvas.addEventListener('pointermove',(event)=>{Object.assign(input.pointer,pointerPosition(event),{active:true});});canvas.addEventListener('pointerleave',()=>input.pointer.active=false);canvas.addEventListener('pointerdown',(event)=>{Object.assign(input.touch,pointerPosition(event),{active:true});});canvas.addEventListener('pointerup',()=>input.touch.active=false);canvas.addEventListener('pointercancel',()=>input.touch.active=false);
  $('#startButton').addEventListener('click',startGame);$('#againButton').addEventListener('click',startGame);$('#resumeButton').addEventListener('click',pauseGame);$('#menuButton').addEventListener('click',()=>{state='MENU';showPanel('menu');resetGame();});$('#muteButton').addEventListener('click',()=>{audioMuted=!audioMuted;$('#muteButton').textContent=audioMuted?'🔇':'🔊';});
  resetGame(); showPanel('menu'); requestAnimationFrame(loop);
})();
