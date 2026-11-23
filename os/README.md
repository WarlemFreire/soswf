# OS SOS WF

Sistema de ordem de serviço com etapas **bloqueantes**. Cada etapa só fecha
quando tudo foi registrado e as medições estão dentro do critério. O objetivo
é reduzir o retorno e conseguir medir essa redução.

**Endereço:** `/os/` no mesmo site. Funciona offline e instala como app.

## Regras

- **Foto só pela câmera do app.** Não há como escolher da galeria. Cada foto
  leva data, hora, GPS e número da OS carimbados na imagem e gravados junto.
  Foto sem GPS aparece marcada.
- **Tempo mínimo é medido pelo relógio do app.** A leitura final do
  nitrogênio (30 min), do vácuo isolado (10 min) e das medições com o aparelho
  ligado (15 min) fica travada até o tempo passar. O motor confere de novo
  pelo horário das fotos, então não depende da tela.
- **Fora do critério** a etapa só fecha como **exceção**, com justificativa
  (mín. 15 caracteres) e foto. Campo obrigatório vazio não fecha nem com exceção.
- **Revisão:** toda OS com exceção, mais um sorteio de 20% das outras.
- **Retorno:** é uma OS nova ligada à original (até 90 dias), com causa
  obrigatória. A taxa em Ajustes só conta OS cuja garantia já venceu, para o
  número não sair otimista.
- **Reabrir** uma etapa reabre também todas as seguintes. Os dados continuam,
  mas cada etapa precisa ser fechada de novo.

## Critérios padrão (editáveis em Ajustes)

| Teste | Critério |
|---|---|
| Nitrogênio | ≥ 30 min; queda **corrigida pela temperatura** ≤ 1 divisão do manômetro |
| Vácuo | ≤ 500 mícron, isolado 10 min sem passar de 1000 |
| Tensão | ±10% da nominal da etiqueta |
| Corrente | ≤ nominal da etiqueta |
| ΔT (retorno − insuflamento) | 8–14 °C após 15 min no frio máximo |

Correção do nitrogênio pela lei dos gases, em pressão absoluta e Kelvin:
`P_esperada = (P_ini + 14,696) × (T_fim + 273,15) / (T_ini + 273,15) − 14,696`.

**Configure a divisão do seu manômetro em Ajustes.** O padrão é 5 psi. Se o
seu marca de 10 em 10, o teste reprova vazamentos que na prática não dá para
ler no ponteiro.

## Roteiros

- **Instalação de split** (13 etapas): fixação da evaporadora e furação podem
  ser feitas em qualquer ordem; o resto é sequencial.
- **Higienização:** ΔT antes e depois, fotos antes e depois, teste de dreno.
- **Manutenção de split e de geladeira:** medições iniciais fixas, depois
  diagnóstico, orçamento com aceite, execução, medições finais e entrega. Na
  geladeira a temperatura interna é só registrada, porque leva horas para
  estabilizar. Quem reprova é tensão e corrente.

Para mudar um roteiro, edite `js/roteiros.js` e rode os testes.

## Servidor (Supabase)

O app grava tudo no celular primeiro e envia quando tem sinal. O único
arquivo que conhece o servidor é `js/sync.js`: trocar por Drive depois mexe
só nele.

1. Crie um projeto no Supabase.
2. No SQL Editor, rode `supabase/schema.sql` (cria a tabela `ordens`, o bucket
   privado `fotos` e as regras de acesso: só usuário logado lê e grava).
3. Em Authentication, crie um usuário para você (e um para cada técnico).
4. No app, em Ajustes: URL do projeto, chave anon, login.

Fotos ocupam ~250 KB cada (~5 MB por instalação). O plano gratuito tem 1 GB
para arquivos, e Ajustes mostra quanto já foi usado.

## Testes

```
sh os/test/check.sh
```
