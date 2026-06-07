# 🎙️ Mimico

Aplicativo Windows em segundo plano para **captura, transcrição e tradução de áudio em tempo real**, com **clonagem de voz** e **microfone virtual**.

## Funcionalidades

- ✅ Captura áudio do sistema (Meet, Squad, Discord, YouTube)
- ✅ Transcrição em tempo real (Whisper GPU)
- ✅ Tradução EN → PT (DeepL API)
- ✅ Overlay invisível em gravação de tela
- ✅ Voz clonada local (OpenVoice) com fallback para API
- ✅ Modo tradutor simultâneo com microfone virtual (VB-Cable)

## Stack

**Electron + TypeScript + Faster-Whisper + DeepL + OpenVoice + VB-Cable**

## Documentação

Toda a documentação está em [`/docs`](docs/):

| Documento | Descrição |
|---|---|
| [Plano de Desenvolvimento](docs/PLAN.md) | Fases, tarefas, critérios de aceite |
| [Arquitetura Técnica](docs/ARCHITECTURE.md) | Componentes, fluxos, decisões |
| [Guia de Uso](docs/GUIDE.md) | Configuração e uso diário |

## Estratégia de Custo

**Padrão: Tudo local = $0/mês** 💰
OpenVoice (GPU) + Faster-Whisper (GPU) + DeepL Free

**Fallback configurável:** Cartesia ($4/mês) · Fish.audio ($11/mês)

## Licença

MIT
