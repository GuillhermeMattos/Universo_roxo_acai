/*
 * Ajustes do restaurante. Só quem cuida do site mexe neste arquivo.
 * O dono do restaurante altera preços e disponibilidade direto na planilha.
 */
window.CONFIG = {
  // Nome que aparece no topo do cardápio.
  nome: 'Açaí da Casa',

  // WhatsApp que recebe os pedidos, com DDD. Exemplo: '11912345678'
  whatsapp: '',

  // Arquivo do logotipo enviado junto com o site. Exemplo: 'logo.png'. Deixe '' para não mostrar.
  logo: '',

  // Link da planilha publicada como CSV (Google Planilhas > Arquivo > Compartilhar > Publicar na Web).
  // Deixe '' para ver o cardápio de demonstração.
  planilha: '',

  // Aceita entrega? Se true, cobra a taxa abaixo (em reais). Use 0 para não cobrar.
  entrega: true,
  taxaEntrega: 5,

  // Formas de pagamento oferecidas.
  pagamentos: ['Pix', 'Cartão', 'Dinheiro']
};
