import type { ScopedMessages } from "@/lib/i18n";

export const operationalPatientsListMessages = {
  "pt-BR": {
    patients: "Pacientes", loading: "Carregando...", registered: "cadastrado", registeredPlural: "cadastrados",
    subtitle: "Gerencie seus pacientes e acompanhe seus históricos.", add: "Adicionar Paciente",
    overdue: "{count} pacientes com follow-up sem resposta há mais de 7 dias", overdueOne: "{count} paciente com follow-up sem resposta há mais de 7 dias",
    sentOn: "{period} — enviado em {date}", unknownDate: "data desconhecida", viewSurgery: "Ver cirurgia",
    search: "Buscar por nome ou telefone...", empty: "Nenhum paciente encontrado.", registration: "Cadastro",
    procedure: "procedimento", procedures: "procedimentos", name: "Nome", birthDate: "Nascimento",
    phone: "Telefone", side: "Lado", actions: "Ações", followupOverdue: "Follow-up sem resposta há mais de 7 dias",
    viewRecord: "Ver Prontuário", right: "Direito", left: "Esquerdo", bilateral: "Bilateral",
  },
  es: {
    patients: "Pacientes", loading: "Cargando...", registered: "registrado", registeredPlural: "registrados",
    subtitle: "Administre sus pacientes y siga sus historiales.", add: "Agregar paciente",
    overdue: "{count} pacientes con seguimiento sin respuesta hace más de 7 días", overdueOne: "{count} paciente con seguimiento sin respuesta hace más de 7 días",
    sentOn: "{period} — enviado el {date}", unknownDate: "fecha desconocida", viewSurgery: "Ver cirugía",
    search: "Buscar por nombre o teléfono...", empty: "No se encontraron pacientes.", registration: "Registro",
    procedure: "procedimiento", procedures: "procedimientos", name: "Nombre", birthDate: "Nacimiento",
    phone: "Teléfono", side: "Lado", actions: "Acciones", followupOverdue: "Seguimiento sin respuesta hace más de 7 días",
    viewRecord: "Ver historia clínica", right: "Derecho", left: "Izquierdo", bilateral: "Bilateral",
  },
} satisfies ScopedMessages<Record<string, string>>;