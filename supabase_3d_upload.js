// Configuração do Supabase para Upload de Projetos 3D
import { supabase } from './supabase.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Configuração do bucket para projetos 3D
const BUCKET_NAME = 'projetos-3d'

class SupabaseProjectManager {
  constructor() {
    this.supabase = supabase
    this.bucketName = BUCKET_NAME
    this.loader = new GLTFLoader()
  }

  // Inicializar bucket (executar uma vez)
  async initializeBucket() {
    try {
      // Criar bucket se não existir
      const { data, error } = await this.supabase.storage.createBucket(this.bucketName, {
        public: true,
        allowedMimeTypes: ['model/gltf-binary', 'application/octet-stream', 'model/gltf+json'],
        fileSizeLimit: 52428800 // 50MB
      })

      if (error && error.message !== 'Bucket already exists') {
        throw error
      }

      console.log('Bucket inicializado com sucesso')
      return { success: true }
    } catch (error) {
      console.error('Erro ao inicializar bucket:', error)
      return { success: false, error }
    }
  }

  // Upload de arquivo 3D
  async uploadProject(file, projectData) {
    try {
      // Validar arquivo
      const allowedTypes = ['.glb', '.gltf', '.obj', '.fbx']
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
      
      if (!allowedTypes.includes(fileExtension)) {
        throw new Error('Tipo de arquivo não suportado. Use: GLB, GLTF, OBJ ou FBX')
      }

      if (file.size > 50 * 1024 * 1024) { // 50MB
        throw new Error('Arquivo muito grande. Limite: 50MB')
      }

      // Gerar nome único do arquivo
      const timestamp = Date.now()
      const fileName = `${timestamp}_${projectData.nome.replace(/[^a-zA-Z0-9]/g, '_')}${fileExtension}`
      const filePath = `projetos/${fileName}`

      // Upload do arquivo
      const { data: uploadData, error: uploadError } = await this.supabase.storage
        .from(this.bucketName)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        throw uploadError
      }

      // Obter URL público
      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath)

      // Salvar metadados no banco
      const projectRecord = {
        nome: projectData.nome,
        autor: projectData.autor,
        descricao: projectData.descricao || '',
        arquivo_url: urlData.publicUrl,
        arquivo_path: filePath,
        arquivo_size: file.size,
        arquivo_tipo: fileExtension,
        status: 'pendente',
        data_upload: new Date().toISOString(),
        dados_3d: projectData.dados3d || null
      }

      const { data: dbData, error: dbError } = await this.supabase
        .from('projetos_3d')
        .insert([projectRecord])
        .select()

      if (dbError) {
        // Se erro no banco, remover arquivo do storage
        await this.supabase.storage.from(this.bucketName).remove([filePath])
        throw dbError
      }

      return {
        success: true,
        projeto: dbData[0],
        fileUrl: urlData.publicUrl
      }

    } catch (error) {
      console.error('Erro no upload:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // Listar projetos pendentes
  async getProjectsPendentes() {
    try {
      const { data, error } = await this.supabase
        .from('projetos_3d')
        .select('*')
        .eq('status', 'pendente')
        .order('data_upload', { ascending: false })

      if (error) throw error

      return { success: true, projetos: data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Aprovar projeto (mover para biblioteca)
  async approveProject(projectId) {
    try {
      const { data, error } = await this.supabase
        .from('projetos_3d')
        .update({ 
          status: 'aprovado',
          data_aprovacao: new Date().toISOString()
        })
        .eq('id', projectId)
        .select()

      if (error) throw error

      return { success: true, projeto: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Rejeitar projeto
  async rejectProject(projectId, motivo = '') {
    try {
      // Buscar dados do projeto
      const { data: projeto, error: fetchError } = await this.supabase
        .from('projetos_3d')
        .select('arquivo_path')
        .eq('id', projectId)
        .single()

      if (fetchError) throw fetchError

      // Remover arquivo do storage
      const { error: storageError } = await this.supabase.storage
        .from(this.bucketName)
        .remove([projeto.arquivo_path])

      if (storageError) console.warn('Erro ao remover arquivo:', storageError)

      // Atualizar status no banco
      const { data, error } = await this.supabase
        .from('projetos_3d')
        .update({ 
          status: 'rejeitado',
          motivo_rejeicao: motivo,
          data_rejeicao: new Date().toISOString()
        })
        .eq('id', projectId)
        .select()

      if (error) throw error

      return { success: true, projeto: data[0] }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Buscar projetos na biblioteca
  async getLibraryProjects(filters = {}) {
    try {
      let query = this.supabase
        .from('projetos_3d')
        .select('*')
        .eq('status', 'aprovado')

      // Aplicar filtros
      if (filters.autor) {
        query = query.ilike('autor', `%${filters.autor}%`)
      }
      
      if (filters.busca) {
        query = query.or(`nome.ilike.%${filters.busca}%,descricao.ilike.%${filters.busca}%`)
      }

      if (filters.tipo) {
        query = query.eq('arquivo_tipo', filters.tipo)
      }

      const { data, error } = await query.order('data_aprovacao', { ascending: false })

      if (error) throw error

      return { success: true, projetos: data }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  // Obter estatísticas
  async getStats() {
    try {
      const { data: pendentes, error: error1 } = await this.supabase
        .from('projetos_3d')
        .select('id', { count: 'exact' })
        .eq('status', 'pendente')

      const { data: aprovados, error: error2 } = await this.supabase
        .from('projetos_3d')
        .select('id', { count: 'exact' })
        .eq('status', 'aprovado')

      const { data: rejeitados, error: error3 } = await this.supabase
        .from('projetos_3d')
        .select('id', { count: 'exact' })
        .eq('status', 'rejeitado')

      if (error1 || error2 || error3) {
        throw error1 || error2 || error3
      }

      return {
        success: true,
        stats: {
          pendentes: pendentes.length,
          aprovados: aprovados.length,
          rejeitados: rejeitados.length,
          total: pendentes.length + aprovados.length + rejeitados.length
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}

// Exemplo de uso
const projectManager = new SupabaseProjectManager()

// Função para upload com interface
async function handleFileUpload(fileInput, formData) {
  const file = fileInput.files[0]
  if (!file) {
    alert('Selecione um arquivo')
    return
  }

  const projectData = {
    nome: formData.nome,
    autor: formData.autor,
    descricao: formData.descricao,
    dados3d: formData.dados3d
  }

  console.log('Iniciando upload...')
  const result = await projectManager.uploadProject(file, projectData)

  if (result.success) {
    console.log('Upload realizado com sucesso!', result.projeto)
    alert('Projeto enviado para aprovação!')
    // Atualizar interface
    loadPendingProjects()
  } else {
    console.error('Erro no upload:', result.error)
    alert(`Erro: ${result.error}`)
  }
}

// Carregar projetos pendentes
async function loadPendingProjects() {
  const result = await projectManager.getProjectsPendentes()
  if (result.success) {
    console.log('Projetos pendentes:', result.projetos)
    // Atualizar interface com os projetos
  }
}

// Aprovar projeto
async function approveProject(projectId) {
  const result = await projectManager.approveProject(projectId)
  if (result.success) {
    console.log('Projeto aprovado:', result.projeto)
    alert('Projeto aprovado e movido para a biblioteca!')
    loadPendingProjects() // Recarregar lista
  } else {
    alert(`Erro ao aprovar: ${result.error}`)
  }
}

// Rejeitar projeto
async function rejectProject(projectId, motivo) {
  const result = await projectManager.rejectProject(projectId, motivo)
  if (result.success) {
    console.log('Projeto rejeitado:', result.projeto)
    alert('Projeto rejeitado e removido!')
    loadPendingProjects() // Recarregar lista
  } else {
    alert(`Erro ao rejeitar: ${result.error}`)
  }
}

export {
  SupabaseProjectManager,
  handleFileUpload,
  loadPendingProjects,
  approveProject,
  rejectProject
}