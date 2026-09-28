import type { ScopedMessages } from "@/lib/i18n";

export const surgeryListMessages = {
  "pt-BR": {
    title: "Procedimentos", loading: "Carregando...", record: "registro", records: "registros",
    history: "Histórico completo de procedimentos cirúrgicos.", newProcedure: "Novo Procedimento",
    searchPlaceholder: "Buscar por paciente ou hospital...", drafts: "Rascunhos", draft: "Rascunho",
    noProcedure: "Nenhum procedimento encontrado.", noSurgery: "Nenhuma cirurgia encontrada.",
    date: "Data", patient: "Paciente", procedures: "Procedimentos", type: "Tipo", hospital: "Hospital", actions: "Ações",
    undefined: "Não definido", continue: "Continuar", viewRecord: "Ver Prontuário", delete: "Excluir",
    deleteSurgery: "Excluir cirurgia", deleteForPatient: "Excluir cirurgia de {patient}",
    deleteTitle: "Excluir cirurgia?", deleteDescriptionBefore: "Tem certeza que deseja excluir a cirurgia de",
    deleteDescriptionAfter: "Esta ação não pode ser desfeita e removerá os dados vinculados ao procedimento.",
    cancel: "Cancelar", deleting: "Excluindo...", deleteSuccess: "Cirurgia excluída com sucesso",
    notFound: "Cirurgia não encontrada", deleteError: "Não foi possível excluir a cirurgia",
  },
  es: {
    title: "Procedimientos", loading: "Cargando...", record: "registro", records: "registros",
    history: "Historial completo de procedimientos quirúrgicos.", newProcedure: "Nuevo procedimiento",
    searchPlaceholder: "Buscar por paciente u hospital...", drafts: "Borradores", draft: "Borrador",
    noProcedure: "No se encontró ningún procedimiento.", noSurgery: "No se encontró ninguna cirugía.",
    date: "Fecha", patient: "Paciente", procedures: "Procedimientos", type: "Tipo", hospital: "Hospital", actions: "Acciones",
    undefined: "Sin definir", continue: "Continuar", viewRecord: "Ver historia clínica", delete: "Eliminar",
    deleteSurgery: "Eliminar cirugía", deleteForPatient: "Eliminar cirugía de {patient}",
    deleteTitle: "¿Eliminar cirugía?", deleteDescriptionBefore: "¿Confirma que desea eliminar la cirugía de",
    deleteDescriptionAfter: "Esta acción no se puede deshacer y eliminará los datos vinculados al procedimiento.",
    cancel: "Cancelar", deleting: "Eliminando...", deleteSuccess: "Cirugía eliminada correctamente",
    notFound: "No se encontró la cirugía", deleteError: "No se pudo eliminar la cirugía",
  },
} satisfies ScopedMessages<Record<string, string>>;

export const surgeryMediaMessages = {
  "pt-BR": {
    requestFailed: "A solicitação não pôde ser concluída.",
    invalidFormat: "Formato inválido", invalidFormatDescription: "\"{file}\" não é uma foto ou vídeo reconhecido.",
    uploadError: "Erro no envio", uploadErrorDescription: "Não foi possível enviar \"{file}\".",
    prepareError: "Não foi possível preparar o prontuário", saveBeforeMedia: "Salve a cirurgia antes de enviar fotos ou vídeos.",
    retryBeforeUpload: "Tente novamente antes de enviar o arquivo.", deleteConfirm: "Excluir \"{file}\"?",
    deleted: "Arquivo excluído", deleteError: "Erro ao excluir", unavailable: "Arquivo indisponível",
    title: "Fotos e Vídeos", preparing: "Preparando...", addMedia: "Adicionar fotos e vídeos",
    creatingDraft: "Criando rascunho para o envio...", addSurgeryMedia: "Adicionar fotos ou vídeos da cirurgia",
    selectHelp: "Clique para selecionar · Múltiplos arquivos permitidos", add: "Adicionar",
    processing: "Processando…", error: "Erro", delete: "Excluir", videoShort: "VÍD", photoShort: "FOTO",
    compressing: "Comprimindo…",
  },
  es: {
    requestFailed: "No se pudo completar la solicitud.",
    invalidFormat: "Formato no válido", invalidFormatDescription: "\"{file}\" no es una foto o un video reconocido.",
    uploadError: "Error de carga", uploadErrorDescription: "No se pudo cargar \"{file}\".",
    prepareError: "No se pudo preparar la historia clínica", saveBeforeMedia: "Guarde la cirugía antes de enviar fotos o videos.",
    retryBeforeUpload: "Inténtelo de nuevo antes de enviar el archivo.", deleteConfirm: "¿Eliminar \"{file}\"?",
    deleted: "Archivo eliminado", deleteError: "Error al eliminar", unavailable: "Archivo no disponible",
    title: "Fotos y videos", preparing: "Preparando...", addMedia: "Agregar fotos y videos",
    creatingDraft: "Creando un borrador para la carga...", addSurgeryMedia: "Agregar fotos o videos de la cirugía",
    selectHelp: "Haga clic para seleccionar · Se permiten varios archivos", add: "Agregar",
    processing: "Procesando…", error: "Error", delete: "Eliminar", videoShort: "VID", photoShort: "FOTO",
    compressing: "Comprimiendo…",
  },
} satisfies ScopedMessages<Record<string, string>>;