## Variant: Tab Bar

### Design stance
Navegação por abas horizontal — minimalista, estilo navegador/Linear.

### Key choices
- **Layout:** Tab bar no topo, conteúdo ocupa 100% da largura
- **Typography:** System font + mono para breadcrumb (`mimico / config`)
- **Color:** Preto total (#0d0d0d) com accent indigo (#6366f1)
- **Accent:** Indigo/violeta — moderno, destaca sem agredir
- **Interaction:** Abas com underline + hover sutil

### Estrutura de navegação
- 6 abas horizontais: Áudio, Legendas, Transcrição, Tradução, TTS, Sobre
- Sair fica dentro da aba "Sobre" (não exposto constante)
- Status bar fixa no rodapé com info rápida

### Destaques
- Status bar no rodapé: mostra pipeline ativo/inativo + TTS atual + whisper
- Click "Configurar →" na status bar leva direto pra aba de Voz
- TTS toggle via chips (Edge/ElevenLabs)
- Preview de legendas

### Trade-offs
- Strong at: Mais espaço pro conteúdo, visual limpo, status bar útil
- Weak at: "Sair" fica dentro da aba Sobre (2 cliques), menos óbvio que sidebar
