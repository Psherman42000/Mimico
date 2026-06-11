## Variant: Sidebar Navigation

### Design stance
Desktop-app native — sidebar como navegação principal, igual VS Code, Discord, Slack.

### Key choices
- **Layout:** Sidebar fixa 200px à esquerda, conteúdo à direita
- **Typography:** System font stack, 14px brand, 13px nav, 12px hints
- **Color:** Dark navy (slate/indigo) — fundo escuro profissional #1a1a2e
- **Accent:** Verde menta (#00d4aa) para actions primárias
- **Interaction:** Sidebar destaca seção ativa com underline + cor accent

### Estrutura de navegação
- Sidebar: Áudio, Legendas, Transcrição, Tradução, Voz (TTS)
- Separador + Sobre, Sair (em vermelho no fim)
- "Sair" sempre visível na sidebar

### Destaques
- TTS toggle com chips Edge/ElevenLabs e reveal condicional dos campos
- Preview de legendas em tempo real na seção Legendas
- Status dos workers em cards dedicados
- Botão de Sair destacado em vermelho no menu

### Trade-offs
- Strong at: Parece app nativo, navegação clara, Sair sempre acessível
- Weak at: Sidebar ocupa espaço horizontal, telas pequenas ficam apertadas
