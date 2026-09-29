/**
 * Algoritmo FALSO, só para testes do motor. Nomes deliberadamente não clínicos
 * (jardinagem); os PMIDs/DOIs são fictícios e nunca devem ser registrados.
 */
import type { AlgorithmDef } from '../../src/decision/types';

export const FAKE: AlgorithmDef = {
  id: 'TESTE_JARDIM',
  versao: '1.0.0',
  patologias: [],
  titulo: 'Exemplo de teste: cuidado com o jardim',
  escopo: 'Somente testes automatizados do motor.',
  foraDeEscopo: [
    { id: 'ESC.COBERTA', texto: 'Área coberta: fora do escopo do exemplo.', quando: { campo: 'area_coberta', op: '==', valor: true } },
  ],
  entradas: [
    { id: 'temperatura', rotulo: 'Temperatura', def: { tipo: 'numero', unidade: '°C', min: -30, max: 50 }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'chuva', rotulo: 'Chuva nas últimas 24 h', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 500 }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'solo', rotulo: 'Solo', def: { tipo: 'enum', valores: ['seco', 'umido', 'encharcado'] }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'ferramentas', rotulo: 'Ferramentas', def: { tipo: 'lista', valores: ['mangueira', 'regador', 'lona'] }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'geada', rotulo: 'Geada prevista', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'area_coberta', rotulo: 'Área coberta', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'vento_medido', rotulo: 'Vento medido no local', def: { tipo: 'numero', unidade: 'km/h', min: 0, max: 200, inteiro: true }, origem: { de: 'intraop', caminho: 'teste.vento' }, momento: 'intraop' },
  ],
  opcoes: [
    { id: 'regar', rotulo: 'Regar' },
    { id: 'esperar', rotulo: 'Esperar', naoCirurgica: true },
    { id: 'cobrir', rotulo: 'Cobrir' },
    { id: 'podar', rotulo: 'Podar' },
  ],
  regras: [
    {
      id: 'R.CALOR', titulo: 'Calor com solo seco',
      quando: { all: [{ campo: 'temperatura', op: '>=', valor: 30 }, { campo: 'solo', op: '==', valor: 'seco' }] },
      efeitos: [{ opcao: 'regar', efeito: 'favorece', forca: 'forte' }],
      motivo: 'Temperatura {temperatura} com solo {solo}.',
      referencias: [{ ref: 'Alfa2001' }],
    },
    {
      id: 'R.CHUVA', titulo: 'Chuva recente',
      quando: { campo: 'chuva', op: '>=', valor: 10 },
      efeitos: [
        { opcao: 'regar', efeito: 'desfavorece', forca: 'forte' },
        { opcao: 'esperar', efeito: 'favorece', forca: 'moderada' },
      ],
      motivo: 'Chuva de {chuva}.',
      referencias: [{ ref: 'Alfa2001' }, { ref: 'Beta2002' }],
    },
    {
      id: 'R.GEADA', titulo: 'Geada prevista',
      quando: { campo: 'geada', op: '==', valor: true },
      efeitos: [{ opcao: 'cobrir', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Geada prevista: {geada}.',
      referencias: [{ ref: 'Gama2003' }],
      controversia: {
        nota: 'As fontes divergem entre cobrir e podar antes da geada.',
        alternativas: [{ opcao: 'podar', argumento: 'Podar reduz a área exposta.', referencias: [{ ref: 'Beta2002' }] }],
      },
    },
    {
      id: 'R.FRIO', titulo: 'Frio ou geada',
      quando: { any: [{ campo: 'temperatura', op: '<', valor: 5 }, { campo: 'geada', op: '==', valor: true }] },
      efeitos: [{ opcao: 'esperar', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Frio.',
      referencias: [{ ref: 'Beta2002' }],
    },
    {
      id: 'R.SOLO', titulo: 'Solo não encharcado',
      quando: { not: { campo: 'solo', op: 'in', valores: ['encharcado'] } },
      efeitos: [{ opcao: 'podar', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Solo {solo}.',
      referencias: [{ ref: 'Gama2003' }],
    },
    {
      id: 'R.LONA', titulo: 'Lona disponível',
      quando: { campo: 'ferramentas', op: 'contem', valor: 'lona' },
      efeitos: [{ opcao: 'cobrir', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'Ferramentas: {ferramentas}.',
      referencias: [{ ref: 'Gama2003' }],
    },
    {
      id: 'R.MORNO', titulo: 'Temperatura amena',
      quando: { campo: 'temperatura', op: 'entre', min: 15, max: 25 },
      efeitos: [{ opcao: 'podar', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'Temperatura {temperatura}.',
      referencias: [{ ref: 'Beta2002' }],
    },
    {
      id: 'R.VENTO', titulo: 'Vento forte',
      quando: { campo: 'vento_medido', op: '>', valor: 60 },
      efeitos: [],
      aviso: true,
      motivo: 'Vento de {vento_medido} no local.',
      referencias: [{ ref: 'Beta2002' }],
    },
  ],
  referencias: [
    { id: 'Alfa2001', citacao: 'Alfa A. Referência fictícia de teste. Rev Teste. 2001;1:1-2.', pmid: '11111111', nivel: 'I', tipo: 'ECR' },
    { id: 'Beta2002', citacao: 'Beta B. Referência fictícia de teste. Rev Teste. 2002;2:3-4.', doi: '10.0000/teste.2002', nivel: 'III', tipo: 'coorte' },
    { id: 'Gama2003', citacao: 'Gama G. Referência fictícia de teste. Rev Teste. 2003;3:5-6.', pmid: '33333333', doi: '10.0000/teste.2003', nivel: 'IV', tipo: 'serie_casos', conflitoInteresse: 'Fictício.' },
  ],
  avisosGerais: ['Exemplo fictício, sem validade fora dos testes.'],
  referenciasGerais: [{ ref: 'Beta2002' }],
};

/** Hash gravado do FAKE, como seria o versions.lock.json. Mudou o FAKE → atualize aqui conscientemente. */
export const FAKE_LOCK: Record<string, string> = {
  'TESTE_JARDIM@1.0.0': 'b2f1b444ba87e8caac5ffe2d7b443109cca5b3c7d491b6715c736f56aa105f24',
};

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
