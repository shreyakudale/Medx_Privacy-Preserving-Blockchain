const fs = require('fs');
let css = fs.readFileSync('frontend/src/styles.css', 'utf8');
css = css.replace(/:root \{[\s\S]*?--font: system-ui, sans-serif;/, \:root {
  --ink: #e2e8f0;
  --paper: #0b111e;
  --surface: #141b2d;
  --line: #1e293b;
  --line-strong: #334155;
  --muted: #94a3b8;
  
  --teal: #06b6d4;
  --teal-soft: rgba(6,182,212,0.15);
  --blue: #3b82f6;
  --violet: #8b5cf6;
  --violet-soft: rgba(139,92,246,0.15);
  --amber: #f59e0b;
  --amber-soft: rgba(245,158,11,0.15);
  --red: #ef4444;
  --red-soft: rgba(239,68,68,0.15);
  
  --r-sm: 8px;
  --r-md: 16px;
  --font: system-ui, sans-serif;\);
fs.writeFileSync('frontend/src/styles.css', css);
